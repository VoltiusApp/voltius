use super::identity::{verify_signature, LocalIdentity};
use super::peers::Rejection;
use super::protocol::{
    decode, encode, wire_addrs, write_frame, Auth, Frame, Hello, ProtocolError, FEATURES,
    MAX_FRAME, PROTOCOL_VERSION,
};
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use snow::StatelessTransportState;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

const NOISE_PARAMS: &str = "Noise_NN_25519_ChaChaPoly_BLAKE2s";
pub(super) const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
// A silent connection must give its pre-auth slot back long before the whole handshake would.
const FIRST_MESSAGE_TIMEOUT: Duration = Duration::from_secs(2);
const NOISE_MAX: usize = 65535;
pub(super) const MAX_CHUNK: usize = NOISE_MAX - 16;
const MAX_PROOFS: usize = super::protocol::MAX_EPOCHS;
const PREAUTH_MAX: usize = 64 * 1024;
const DEVICE_CONTEXT: &[u8] = b"voltius-lan-sync-device-v1";
pub(super) const WRITE_TIMEOUT: Duration = Duration::from_secs(30);
const PING_EVERY: Duration = if cfg!(test) {
    Duration::from_millis(100)
} else {
    Duration::from_secs(10)
};
pub(super) const IDLE_TIMEOUT: Duration = if cfg!(test) {
    Duration::from_secs(3)
} else {
    Duration::from_secs(30)
};
const MAX_DEVICE_ID: usize = 128;
const SAS_COMMIT_CONTEXT: &[u8] = b"voltius-lan-sync-sas-commit-v1";
const SAS_INFO: &[u8] = b"voltius-lan-sync-sas-v1";

pub enum Mode<'a> {
    Keys(&'a [[u8; 32]]),
    Pair,
    Accept { keys: &'a [[u8; 32]], pairing: bool },
}

pub struct Handshake {
    pub session: Session,
    pub peer: Hello,
    pub matched: Option<usize>,
    pub sas: Option<u32>,
}

#[derive(thiserror::Error, Debug)]
pub enum HandshakeError {
    #[error("handshake timed out")]
    Timeout,
    #[error("noise: {0}")]
    Noise(String),
    #[error("peer is not on this account")]
    NotTrusted,
    #[error("peer speaks protocol version {0}")]
    VersionMismatch(u16),
    #[error(transparent)]
    Protocol(#[from] ProtocolError),
    #[error("peer {0} refused by pin: {1:?}")]
    Pinned(String, Rejection),
    #[error("peer {0} refused: outside this device's current group or account")]
    Excluded(String),
    #[error("pairing is not open")]
    PairingClosed,
}

impl HandshakeError {
    pub fn refused_peer(&self) -> Option<&str> {
        match self {
            Self::Pinned(id, _) | Self::Excluded(id) => Some(id),
            _ => None,
        }
    }
}

impl From<snow::Error> for HandshakeError {
    fn from(e: snow::Error) -> Self {
        Self::Noise(e.to_string())
    }
}

impl From<std::io::Error> for HandshakeError {
    fn from(e: std::io::Error) -> Self {
        Self::Protocol(e.into())
    }
}

fn malformed(why: &str) -> HandshakeError {
    ProtocolError::Malformed(why.into()).into()
}

pub struct SessionReader {
    io: Box<dyn AsyncRead + Send + Unpin>,
    noise: Arc<StatelessTransportState>,
    nonce: u64,
    sealed: Vec<u8>,
    plain: Vec<u8>,
    idle: Option<Duration>,
}

pub struct SessionWriter {
    io: Box<dyn AsyncWrite + Send + Unpin>,
    noise: Arc<StatelessTransportState>,
    nonce: u64,
    stall: Option<Duration>,
}

pub struct Session {
    reader: SessionReader,
    writer: SessionWriter,
    hash: Vec<u8>,
}

fn eof() -> std::io::Error {
    std::io::ErrorKind::UnexpectedEof.into()
}

async fn read_msg_or_eof<R: AsyncRead + Unpin>(
    io: &mut R,
    buf: &mut [u8],
) -> std::io::Result<Option<usize>> {
    let mut len = [0u8; 2];
    if io.read(&mut len[..1]).await? == 0 {
        return Ok(None);
    }
    io.read_exact(&mut len[1..]).await?;
    let len = u16::from_be_bytes(len) as usize;
    io.read_exact(&mut buf[..len]).await?;
    Ok(Some(len))
}

async fn read_msg<R: AsyncRead + Unpin>(io: &mut R, buf: &mut [u8]) -> std::io::Result<usize> {
    read_msg_or_eof(io, buf).await?.ok_or_else(eof)
}

fn push_msg(
    wire: &mut Vec<u8>,
    seal: impl FnOnce(&mut [u8]) -> Result<usize, snow::Error>,
) -> Result<(), snow::Error> {
    let start = wire.len();
    wire.resize(start + 2 + NOISE_MAX, 0);
    let n = seal(&mut wire[start + 2..])?;
    wire[start..start + 2].copy_from_slice(&(n as u16).to_be_bytes());
    wire.truncate(start + 2 + n);
    Ok(())
}

async fn bounded<T, E: Into<HandshakeError>>(
    limit: Option<Duration>,
    io: impl std::future::Future<Output = Result<T, E>>,
) -> Result<T, HandshakeError> {
    match limit {
        Some(limit) => tokio::time::timeout(limit, io)
            .await
            .map_err(|_| HandshakeError::Timeout)?
            .map_err(Into::into),
        None => io.await.map_err(Into::into),
    }
}

fn next_nonce(nonce: &mut u64) -> u64 {
    let n = *nonce;
    *nonce += 1;
    n
}

impl SessionReader {
    pub fn set_idle_timeout(&mut self, idle: Duration) {
        self.idle = Some(idle);
    }

    async fn open_or_eof(&mut self) -> Result<Option<usize>, HandshakeError> {
        let read = read_msg_or_eof(&mut self.io, &mut self.sealed);
        let Some(n) = bounded(self.idle, read).await? else {
            return Ok(None);
        };
        let nonce = next_nonce(&mut self.nonce);
        Ok(Some(self.noise.read_message(
            nonce,
            &self.sealed[..n],
            &mut self.plain,
        )?))
    }

    async fn open_next(&mut self) -> Result<usize, HandshakeError> {
        Ok(self.open_or_eof().await?.ok_or_else(eof)?)
    }

    pub(super) async fn recv_chunk(&mut self) -> Result<Option<&[u8]>, HandshakeError> {
        loop {
            match self.open_or_eof().await? {
                None => return Ok(None),
                Some(0) => continue,
                Some(n) => return Ok(Some(&self.plain[..n])),
            }
        }
    }

    pub async fn recv(&mut self) -> Result<Frame, HandshakeError> {
        self.recv_max(MAX_FRAME).await
    }

    pub async fn recv_max(&mut self, limit: usize) -> Result<Frame, HandshakeError> {
        let first = self.recv_chunk().await?.ok_or_else(eof)?;
        let (prefix, rest) = first
            .split_first_chunk::<4>()
            .ok_or_else(|| malformed("chunk shorter than a frame header"))?;
        let len = u32::from_be_bytes(*prefix) as usize;
        if len > limit.min(MAX_FRAME) {
            return Err(ProtocolError::TooLarge(len).into());
        }
        let mut frame = rest.to_vec();
        while frame.len() < len {
            let n = self.open_next().await?;
            frame.extend_from_slice(&self.plain[..n]);
        }
        if frame.len() != len {
            return Err(malformed("frame overran its length"));
        }
        Ok(decode(&frame)?)
    }
}

impl SessionWriter {
    pub fn set_write_timeout(&mut self, stall: Duration) {
        self.stall = Some(stall);
    }

    pub async fn send(&mut self, f: &Frame) -> Result<(), HandshakeError> {
        self.send_raw(&encode(f)?).await
    }

    pub async fn keepalive(&mut self) -> Result<(), HandshakeError> {
        self.seal_and_write(std::iter::once(&[][..])).await
    }

    pub(super) async fn send_raw(&mut self, bytes: &[u8]) -> Result<(), HandshakeError> {
        self.seal_and_write(bytes.chunks(MAX_CHUNK)).await
    }

    pub(super) async fn finish(&mut self) -> Result<(), HandshakeError> {
        bounded(self.stall, self.io.shutdown()).await
    }

    async fn seal_and_write<'a>(
        &mut self,
        chunks: impl Iterator<Item = &'a [u8]>,
    ) -> Result<(), HandshakeError> {
        let mut wire = Vec::with_capacity(NOISE_MAX + 2);
        for chunk in chunks {
            wire.clear();
            let nonce = next_nonce(&mut self.nonce);
            push_msg(&mut wire, |out| self.noise.write_message(nonce, chunk, out))?;
            bounded(self.stall, write_frame(&mut self.io, &wire)).await?;
        }
        Ok(())
    }
}

impl Session {
    pub async fn send(&mut self, f: &Frame) -> Result<(), HandshakeError> {
        self.writer.send(f).await
    }

    #[cfg(test)]
    pub async fn recv(&mut self) -> Result<Frame, HandshakeError> {
        self.reader.recv().await
    }

    pub async fn recv_max(&mut self, limit: usize) -> Result<Frame, HandshakeError> {
        self.reader.recv_max(limit).await
    }

    pub fn handshake_hash(&self) -> &[u8] {
        &self.hash
    }

    pub fn split(self) -> (SessionReader, SessionWriter) {
        (self.reader, self.writer)
    }

    pub(super) fn split_live(self) -> (SessionReader, SessionWriter) {
        let (mut reader, mut writer) = self.split();
        reader.set_idle_timeout(IDLE_TIMEOUT);
        writer.set_write_timeout(WRITE_TIMEOUT);
        (reader, writer)
    }
}

pub(super) fn ping_timer() -> tokio::time::Interval {
    tokio::time::interval_at(tokio::time::Instant::now() + PING_EVERY, PING_EVERY)
}

async fn noise<S: AsyncRead + AsyncWrite + Unpin + Send + 'static>(
    mut stream: S,
    initiator: bool,
) -> Result<Session, HandshakeError> {
    let builder = snow::Builder::new(NOISE_PARAMS.parse()?);
    let mut hs = if initiator {
        builder.build_initiator()?
    } else {
        builder.build_responder()?
    };
    let mut sealed = vec![0u8; NOISE_MAX];
    let mut plain = vec![0u8; NOISE_MAX];
    let mut first_read = Some(FIRST_MESSAGE_TIMEOUT);
    while !hs.is_handshake_finished() {
        if hs.is_my_turn() {
            let mut wire = Vec::new();
            push_msg(&mut wire, |out| hs.write_message(&[], out))?;
            write_frame(&mut stream, &wire).await?;
        } else {
            let n = bounded(first_read.take(), read_msg(&mut stream, &mut sealed)).await?;
            hs.read_message(&sealed[..n], &mut plain)?;
        }
    }
    let hash = hs.get_handshake_hash().to_vec();
    let noise = Arc::new(hs.into_stateless_transport_mode()?);
    let (r, w) = tokio::io::split(stream);
    let session = Session {
        reader: SessionReader {
            io: Box::new(r),
            noise: noise.clone(),
            nonce: 0,
            sealed,
            plain,
            idle: None,
        },
        writer: SessionWriter {
            io: Box::new(w),
            noise,
            nonce: 0,
            stall: None,
        },
        hash,
    };
    Ok(session)
}

// The role byte stops a peer from reflecting our own proofs or signature back at us.
fn role(initiator: bool) -> [u8; 1] {
    [u8::from(initiator)]
}

fn mac(auth_key: &[u8; 32], handshake_hash: &[u8], initiator: bool) -> Hmac<Sha256> {
    let mut m = Hmac::<Sha256>::new_from_slice(auth_key).expect("HMAC takes any key length");
    m.update(&role(initiator));
    m.update(handshake_hash);
    m
}

fn device_msg(handshake_hash: &[u8], initiator: bool) -> Vec<u8> {
    [DEVICE_CONTEXT, &role(initiator), handshake_hash].concat()
}

fn hello(me: &LocalIdentity, handshake_hash: &[u8], initiator: bool) -> Hello {
    Hello {
        device_id: me.device_id.clone(),
        device_name: me.device_name.clone(),
        platform: me.platform.clone(),
        device_key: me.key.public,
        device_sig: me.key.sign(&device_msg(handshake_hash, initiator)).to_vec(),
        addrs: wire_addrs(&(me.addrs)()),
        features: FEATURES.iter().map(|f| f.to_string()).collect(),
    }
}

pub fn valid_device_id(id: &str) -> bool {
    (1..=MAX_DEVICE_ID).contains(&id.len())
}

fn verify_device(peer: &Hello, peer_is_initiator: bool, hash: &[u8]) -> Result<(), HandshakeError> {
    let msg = device_msg(hash, peer_is_initiator);
    if valid_device_id(&peer.device_id)
        && verify_signature(&peer.device_key, &msg, &peer.device_sig)
    {
        Ok(())
    } else {
        Err(HandshakeError::NotTrusted)
    }
}

fn proof(auth_key: &[u8; 32], handshake_hash: &[u8], initiator: bool) -> [u8; 32] {
    mac(auth_key, handshake_hash, initiator)
        .finalize()
        .into_bytes()
        .into()
}

fn check_version(peer: &Auth) -> Result<(), HandshakeError> {
    if peer.version == PROTOCOL_VERSION {
        Ok(())
    } else {
        Err(HandshakeError::VersionMismatch(peer.version))
    }
}

fn verify(
    peer: &Auth,
    peer_is_initiator: bool,
    auth_keys: &[[u8; 32]],
    hash: &[u8],
) -> Result<usize, HandshakeError> {
    let matched = (!peer.pair
        && peer.commit.is_none()
        && peer.nonce.is_none()
        && peer.proofs.len() <= MAX_PROOFS)
        .then(|| {
            auth_keys.iter().position(|k| {
                peer.proofs
                    .iter()
                    .any(|p| mac(k, hash, peer_is_initiator).verify_slice(p).is_ok())
            })
        })
        .flatten()
        .ok_or(HandshakeError::NotTrusted)?;
    check_version(peer)?;
    Ok(matched)
}

pub fn sas(handshake_hash: &[u8], na: &[u8; 32], nb: &[u8; 32]) -> u32 {
    let mut out = [0u8; 4];
    Hkdf::<Sha256>::new(None, &[handshake_hash, na, nb].concat())
        .expand(SAS_INFO, &mut out)
        .expect("4 bytes is a valid HKDF length");
    u32::from_be_bytes(out) % 1_000_000
}

fn sas_commit(handshake_hash: &[u8], na: &[u8; 32]) -> [u8; 32] {
    Sha256::new()
        .chain_update(SAS_COMMIT_CONTEXT)
        .chain_update(handshake_hash)
        .chain_update(na)
        .finalize()
        .into()
}

fn constant_time_eq(a: &[u8; 32], b: &[u8; 32]) -> bool {
    a.iter().zip(b).fold(0u8, |d, (x, y)| d | (x ^ y)) == 0
}

fn pair_auth(commit: Option<[u8; 32]>, nonce: Option<[u8; 32]>) -> Frame {
    Frame::Auth(Auth {
        version: PROTOCOL_VERSION,
        pair: true,
        commit,
        nonce,
        ..Default::default()
    })
}

fn pair_nonce(auth: &Auth, commit_expected: bool) -> Result<Option<[u8; 32]>, HandshakeError> {
    let shaped = auth.pair
        && auth.proofs.is_empty()
        && auth.commit.is_some() == commit_expected
        && auth.nonce.is_some() != commit_expected;
    if shaped {
        check_version(auth)?;
        Ok(auth.nonce)
    } else {
        Err(HandshakeError::NotTrusted)
    }
}

async fn recv_preauth(session: &mut Session) -> Result<Frame, HandshakeError> {
    match session.recv_max(PREAUTH_MAX).await? {
        Frame::Bye => Err(HandshakeError::NotTrusted),
        Frame::Unknown(kind) => Err(ProtocolError::UnknownKind(kind).into()),
        f => Ok(f),
    }
}

async fn bye_unless<T>(
    session: &mut Session,
    check: Result<T, HandshakeError>,
) -> Result<T, HandshakeError> {
    if check.is_err() {
        let _ = session.send(&Frame::Bye).await;
    }
    check
}

struct Authenticated {
    peer: Hello,
    matched: Option<usize>,
    sas: Option<u32>,
}

async fn authenticate(
    session: &mut Session,
    initiator: bool,
    me: &LocalIdentity,
    mode: &Mode<'_>,
) -> Result<Authenticated, HandshakeError> {
    let hash = session.hash.clone();
    let keys: &[[u8; 32]] = match mode {
        Mode::Keys(keys) | Mode::Accept { keys, .. } => keys,
        Mode::Pair => &[],
    };
    let key_auth = || {
        Frame::Auth(Auth {
            version: PROTOCOL_VERSION,
            proofs: keys.iter().map(|k| proof(k, &hash, initiator)).collect(),
            ..Default::default()
        })
    };
    let my_hello = || Frame::Hello(hello(me, &hash, initiator));
    let pair_out = match (initiator, mode) {
        (true, Mode::Pair) => true,
        (true, Mode::Keys(_)) | (false, Mode::Accept { .. } | Mode::Keys(_)) => false,
        _ => return Err(malformed("handshake mode does not match the role")),
    };
    let my_nonce: [u8; 32] = rand::random();
    if initiator {
        let first = if pair_out {
            pair_auth(Some(sas_commit(&hash, &my_nonce)), None)
        } else {
            key_auth()
        };
        session.send(&first).await?;
    }
    let Frame::Auth(peer_auth) = recv_preauth(session).await? else {
        return Err(malformed("expected auth"));
    };
    let mut matched = None;
    let mut commit = None;
    let mut peer_nonce = None;
    if initiator && pair_out {
        peer_nonce = bye_unless(session, pair_nonce(&peer_auth, false)).await?;
    } else if !initiator && peer_auth.pair {
        if !matches!(mode, Mode::Accept { pairing: true, .. }) {
            let _ = session.send(&Frame::Bye).await;
            return Err(HandshakeError::PairingClosed);
        }
        bye_unless(session, pair_nonce(&peer_auth, true)).await?;
        commit = peer_auth.commit;
    } else {
        matched = Some(bye_unless(session, verify(&peer_auth, !initiator, keys, &hash)).await?);
    }
    if !initiator {
        let reply = if commit.is_some() {
            pair_auth(None, Some(my_nonce))
        } else {
            key_auth()
        };
        session.send(&reply).await?;
        session.send(&my_hello()).await?;
    }
    if let Some(commit) = commit {
        let Frame::Auth(reveal) = recv_preauth(session).await? else {
            return Err(malformed("expected pairing reveal"));
        };
        let revealed = bye_unless(session, pair_nonce(&reveal, false)).await?;
        let honest = revealed.is_some_and(|na| constant_time_eq(&sas_commit(&hash, &na), &commit));
        bye_unless(
            session,
            honest.then_some(()).ok_or(HandshakeError::NotTrusted),
        )
        .await?;
        peer_nonce = revealed;
    }
    let Frame::Hello(peer) = recv_preauth(session).await? else {
        return Err(malformed("expected hello"));
    };
    bye_unless(session, verify_device(&peer, !initiator, &hash)).await?;
    if initiator {
        if pair_out {
            session.send(&pair_auth(None, Some(my_nonce))).await?;
        }
        session.send(&my_hello()).await?;
    }
    let sas = peer_nonce.map(|theirs| {
        let (na, nb) = if initiator {
            (&my_nonce, &theirs)
        } else {
            (&theirs, &my_nonce)
        };
        sas(&hash, na, nb)
    });
    Ok(Authenticated { peer, matched, sas })
}

pub async fn handshake_with<S: AsyncRead + AsyncWrite + Unpin + Send + 'static>(
    stream: S,
    initiator: bool,
    me: &LocalIdentity,
    mode: Mode<'_>,
) -> Result<Handshake, HandshakeError> {
    let run = async {
        let mut session = noise(stream, initiator).await?;
        let a = authenticate(&mut session, initiator, me, &mode).await?;
        Ok(Handshake {
            session,
            peer: a.peer,
            matched: a.matched,
            sas: a.sas,
        })
    };
    tokio::time::timeout(HANDSHAKE_TIMEOUT, run)
        .await
        .map_err(|_| HandshakeError::Timeout)?
}

#[cfg(test)]
pub async fn handshake<S: AsyncRead + AsyncWrite + Unpin + Send + 'static>(
    stream: S,
    initiator: bool,
    me: &LocalIdentity,
    auth_keys: &[[u8; 32]],
) -> Result<(Session, Hello), HandshakeError> {
    let h = handshake_with(stream, initiator, me, Mode::Keys(auth_keys)).await?;
    Ok((h.session, h.peer))
}

#[cfg(test)]
pub(crate) async fn initiate_with_hello<S: AsyncRead + AsyncWrite + Unpin + Send + 'static>(
    stream: S,
    me: &LocalIdentity,
    auth_keys: &[[u8; 32]],
    wire: impl FnOnce(Hello) -> Vec<u8>,
) -> (Session, Vec<Frame>) {
    let mut s = noise(stream, true).await.unwrap();
    let hash = s.handshake_hash().to_vec();
    let proofs = auth_keys.iter().map(|k| proof(k, &hash, true)).collect();
    s.send(&Frame::Auth(Auth {
        version: PROTOCOL_VERSION,
        proofs,
        ..Default::default()
    }))
    .await
    .unwrap();
    let seen = vec![s.recv().await.unwrap(), s.recv().await.unwrap()];
    s.writer
        .send_raw(&wire(hello(me, &hash, true)))
        .await
        .unwrap();
    (s, seen)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lan_sync::identity::{derive_auth_key, test_identity as identity};
    use tokio::io::{duplex, AsyncWriteExt};

    type Outcome = Result<(Session, Hello), HandshakeError>;

    async fn pair(a_keys: &[[u8; 32]], b_keys: &[[u8; 32]]) -> (Outcome, Outcome) {
        let (a, b) = duplex(64 * 1024);
        let (ia, ib) = (identity("dev-a"), identity("dev-b"));
        tokio::join!(
            handshake(a, true, &ia, a_keys),
            handshake(b, false, &ib, b_keys)
        )
    }

    #[tokio::test]
    async fn hello_carries_identity_addrs() {
        let mut ia = identity("dev-a");
        ia.addrs = Arc::new(|| vec!["10.0.0.2:47391".parse().unwrap()]);
        let (a, b) = duplex(64 * 1024);
        let ib = identity("dev-b");
        let keys = [derive_auth_key(&[1; 32])];
        let (_, rb) = tokio::join!(
            handshake(a, true, &ia, &keys),
            handshake(b, false, &ib, &keys)
        );
        assert_eq!(
            peer(&rb).peer_addrs(),
            vec!["10.0.0.2:47391".parse::<std::net::SocketAddr>().unwrap()]
        );
    }

    fn peer(o: &Outcome) -> &Hello {
        &o.as_ref().map_err(|e| e.to_string()).unwrap().1
    }

    fn keyless() -> Auth {
        Auth {
            version: PROTOCOL_VERSION,
            proofs: vec![[0xAB; 32]],
            ..Default::default()
        }
    }

    async fn drain(mut s: Session, mut seen: Vec<Frame>) -> Vec<Frame> {
        while let Ok(Ok(f)) = tokio::time::timeout(Duration::from_secs(5), s.recv()).await {
            seen.push(f);
        }
        seen
    }

    async fn rogue_initiator<S>(stream: S, auth: impl FnOnce(&[u8]) -> Auth) -> Vec<Frame>
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let mut s = noise(stream, true).await.unwrap();
        let auth = auth(s.handshake_hash());
        s.send(&Frame::Auth(auth)).await.unwrap();
        drain(s, vec![]).await
    }

    async fn rogue_responder<S>(stream: S, reply: impl FnOnce(&Auth) -> Auth) -> Vec<Frame>
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let mut s = noise(stream, false).await.unwrap();
        let first = s.recv().await.unwrap();
        let Frame::Auth(auth) = &first else {
            panic!("initiator opened with {first:?}");
        };
        s.send(&Frame::Auth(reply(auth))).await.unwrap();
        drain(s, vec![first]).await
    }

    async fn rogue_after_auth<S>(
        stream: S,
        keys: &[[u8; 32]],
        wire: impl FnOnce(Hello) -> Vec<u8>,
    ) -> Vec<Frame>
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let (s, seen) = initiate_with_hello(stream, &identity("dev-a"), keys, wire).await;
        drain(s, seen).await
    }

    async fn opens_with<S>(stream: S, raw: &[u8]) -> Session
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let mut s = noise(stream, true).await.unwrap();
        s.writer.send_raw(raw).await.unwrap();
        s
    }

    #[tokio::test]
    async fn same_account_handshake_succeeds() {
        let k = derive_auth_key(&[1; 32]);
        let (a, b) = pair(&[k], &[k]).await;
        assert_eq!(peer(&a).device_id, "dev-b");
        assert_eq!(peer(&a).device_key, identity("dev-b").key.public);
        assert_eq!(peer(&b).device_id, "dev-a");
        assert_eq!(peer(&b).device_name, "dev-a name");
        assert_eq!(peer(&b).device_key, identity("dev-a").key.public);
    }

    #[tokio::test]
    async fn any_shared_key_is_enough() {
        let (dek, kek) = (derive_auth_key(&[2; 32]), derive_auth_key(&[3; 32]));
        for (a_keys, b_keys) in [(vec![dek, kek], vec![kek]), (vec![kek], vec![dek, kek])] {
            let (a, b) = pair(&a_keys, &b_keys).await;
            assert_eq!(peer(&a).device_id, "dev-b");
            assert_eq!(peer(&b).device_id, "dev-a");
        }
    }

    #[tokio::test]
    async fn different_account_is_rejected() {
        let (a, b) = pair(&[derive_auth_key(&[4; 32])], &[derive_auth_key(&[5; 32])]).await;
        assert!(matches!(a, Err(HandshakeError::NotTrusted)));
        assert!(matches!(b, Err(HandshakeError::NotTrusted)));
    }

    #[tokio::test]
    async fn no_keys_is_rejected() {
        let k = derive_auth_key(&[6; 32]);
        let (a, b) = pair(&[], &[k]).await;
        assert!(matches!(a, Err(HandshakeError::NotTrusted)));
        assert!(matches!(b, Err(HandshakeError::NotTrusted)));
    }

    #[tokio::test]
    async fn version_mismatch_is_rejected() {
        let keys = [derive_auth_key(&[1; 32])];
        let me = identity("dev-b");
        let future = |hash: &[u8]| Auth {
            version: 99,
            proofs: vec![proof(&keys[0], hash, true)],
            ..Default::default()
        };
        let (a, b) = duplex(64 * 1024);
        let (seen, real) =
            tokio::join!(rogue_initiator(a, future), handshake(b, false, &me, &keys));
        assert!(matches!(real, Err(HandshakeError::VersionMismatch(99))));
        assert_eq!(seen, vec![Frame::Bye]);

        let stranger = |_: &[u8]| Auth {
            version: 99,
            ..keyless()
        };
        let (a, b) = duplex(64 * 1024);
        let (seen, real) = tokio::join!(
            rogue_initiator(a, stranger),
            handshake(b, false, &me, &keys)
        );
        assert!(matches!(real, Err(HandshakeError::NotTrusted)));
        assert_eq!(seen, vec![Frame::Bye]);
    }

    #[tokio::test]
    async fn rogue_responder_learns_no_identity() {
        let keys = [derive_auth_key(&[1; 32])];
        let me = identity("dev-a");
        let (a, b) = duplex(64 * 1024);
        let (real, seen) = tokio::join!(
            handshake(a, true, &me, &keys),
            rogue_responder(b, |_| keyless())
        );
        assert!(matches!(real, Err(HandshakeError::NotTrusted)));
        assert!(matches!(&seen[..], [Frame::Auth(_), Frame::Bye]));
        let dump = format!("{seen:?}");
        assert!(!dump.contains("dev-a") && !dump.contains("linux"));
    }

    #[tokio::test]
    async fn rogue_initiator_gets_bye_not_hello() {
        let keys = [derive_auth_key(&[1; 32])];
        let me = identity("dev-b");
        let (a, b) = duplex(64 * 1024);
        let (seen, real) = tokio::join!(
            rogue_initiator(a, |_| keyless()),
            handshake(b, false, &me, &keys)
        );
        assert!(matches!(real, Err(HandshakeError::NotTrusted)));
        assert_eq!(seen, vec![Frame::Bye]);
    }

    #[tokio::test]
    async fn responder_builds_no_hello_for_an_untrusted_peer() {
        let keys = [derive_auth_key(&[1; 32])];
        let calls = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counted = calls.clone();
        let me = LocalIdentity {
            addrs: Arc::new(move || {
                counted.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                vec![]
            }),
            ..identity("dev-b")
        };
        let (a, b) = duplex(64 * 1024);
        let (_seen, real) = tokio::join!(
            rogue_initiator(a, |_| keyless()),
            handshake(b, false, &me, &keys)
        );
        assert!(matches!(real, Err(HandshakeError::NotTrusted)));
        assert_eq!(calls.load(std::sync::atomic::Ordering::Relaxed), 0);
    }

    #[tokio::test]
    async fn device_id_must_be_1_to_128_bytes() {
        let keys = [derive_auth_key(&[1; 32])];
        let honest = identity("dev-b");
        for (id, ok) in [
            (String::new(), false),
            ("x".repeat(129), false),
            ("x".repeat(128), true),
        ] {
            let odd = identity(&id);
            for odd_initiates in [true, false] {
                let (a, b) = duplex(64 * 1024);
                let (_, real) = tokio::join!(
                    handshake(a, odd_initiates, &odd, &keys),
                    handshake(b, !odd_initiates, &honest, &keys)
                );
                match real {
                    Ok(_) => assert!(ok, "{} accepted", id.len()),
                    Err(e) => assert!(!ok && matches!(e, HandshakeError::NotTrusted), "{e}"),
                }
            }
        }
    }

    #[tokio::test]
    async fn reflected_proofs_are_rejected() {
        let keys = [derive_auth_key(&[1; 32])];
        let me = identity("dev-a");
        let (a, b) = duplex(64 * 1024);
        let (real, seen) = tokio::join!(
            handshake(a, true, &me, &keys),
            rogue_responder(b, Auth::clone)
        );
        assert!(matches!(real, Err(HandshakeError::NotTrusted)));
        assert!(matches!(&seen[..], [Frame::Auth(_), Frame::Bye]));
    }

    #[tokio::test]
    async fn preauth_frame_over_64k_is_rejected() {
        let keys = [derive_auth_key(&[1; 32])];
        let me = identity("dev-b");
        let (a, b) = duplex(64 * 1024);
        let claim = (PREAUTH_MAX as u32 + 1).to_be_bytes();
        let (_rogue, real) = tokio::join!(opens_with(a, &claim), handshake(b, false, &me, &keys));
        assert!(matches!(
            real,
            Err(HandshakeError::Protocol(ProtocolError::TooLarge(n))) if n == PREAUTH_MAX + 1
        ));
    }

    #[tokio::test]
    async fn peer_with_forged_device_key_is_rejected() {
        let keys = [derive_auth_key(&[1; 32])];
        let honest = identity("dev-b");
        let mut forger = identity("dev-a");
        forger.key.public = identity("dev-c").key.public;
        for forger_initiates in [true, false] {
            let (a, b) = duplex(64 * 1024);
            let (forged, real) = tokio::join!(
                handshake(a, forger_initiates, &forger, &keys),
                handshake(b, !forger_initiates, &honest, &keys)
            );
            assert!(matches!(real, Err(HandshakeError::NotTrusted)));
            match forged {
                Ok((mut s, _)) => {
                    assert!(forger_initiates);
                    assert_eq!(s.recv().await.unwrap(), Frame::Bye);
                }
                Err(e) => assert!(matches!(e, HandshakeError::NotTrusted), "{e}"),
            }
        }
    }

    #[tokio::test]
    async fn wrong_length_signature_is_rejected() {
        let keys = [derive_auth_key(&[1; 32])];
        let me = identity("dev-b");
        for len in [0, 63, 65] {
            let resized = |mut h: Hello| {
                h.device_sig.resize(len, 0);
                encode(&Frame::Hello(h)).unwrap()
            };
            let (a, b) = duplex(64 * 1024);
            let (seen, real) = tokio::join!(
                rogue_after_auth(a, &keys, resized),
                handshake(b, false, &me, &keys)
            );
            assert!(matches!(real, Err(HandshakeError::NotTrusted)), "len {len}");
            assert!(matches!(
                &seen[..],
                [Frame::Auth(_), Frame::Hello(_), Frame::Bye]
            ));
        }
    }

    #[test]
    fn signature_is_bound_to_role() {
        let hash = [5u8; 32];
        let as_initiator = hello(&identity("dev-a"), &hash, true);
        assert!(verify_device(&as_initiator, true, &hash).is_ok());
        assert!(matches!(
            verify_device(&as_initiator, false, &hash),
            Err(HandshakeError::NotTrusted)
        ));
        assert!(matches!(
            verify_device(&as_initiator, true, &[6u8; 32]),
            Err(HandshakeError::NotTrusted)
        ));
    }

    #[tokio::test]
    async fn unknown_kind_during_handshake_is_rejected() {
        let keys = [derive_auth_key(&[1; 32])];
        let me = identity("dev-b");
        let unknown = [0, 0, 0, 1, 0xEE];
        let is_unknown = |r: &Outcome| {
            matches!(
                r,
                Err(HandshakeError::Protocol(ProtocolError::UnknownKind(0xEE)))
            )
        };

        let (a, b) = duplex(64 * 1024);
        let (_rogue, real) = tokio::join!(opens_with(a, &unknown), handshake(b, false, &me, &keys));
        assert!(is_unknown(&real));

        let (a, b) = duplex(64 * 1024);
        let (seen, real) = tokio::join!(
            rogue_after_auth(a, &keys, |_| unknown.to_vec()),
            handshake(b, false, &me, &keys)
        );
        assert!(is_unknown(&real));
        assert!(matches!(&seen[..], [Frame::Auth(_), Frame::Hello(_)]));
    }

    #[tokio::test(start_paused = true)]
    async fn silent_peer_times_out_on_the_first_message() {
        let k = derive_auth_key(&[1; 32]);
        for initiator in [true, false] {
            let (a, _silent) = duplex(64 * 1024);
            let started = tokio::time::Instant::now();
            let r = handshake(a, initiator, &identity("dev-a"), &[k]).await;
            assert!(matches!(r, Err(HandshakeError::Timeout)));
            assert!(started.elapsed() >= FIRST_MESSAGE_TIMEOUT);
            assert!(started.elapsed() < HANDSHAKE_TIMEOUT);
        }
    }

    #[tokio::test(start_paused = true)]
    async fn peer_stalling_after_its_first_message_gets_the_whole_timeout() {
        let k = derive_auth_key(&[1; 32]);
        let (a, mut rogue) = duplex(64 * 1024);
        let mut hs = snow::Builder::new(NOISE_PARAMS.parse().unwrap())
            .build_initiator()
            .unwrap();
        let mut wire = Vec::new();
        push_msg(&mut wire, |out| hs.write_message(&[], out)).unwrap();
        write_frame(&mut rogue, &wire).await.unwrap();
        let started = tokio::time::Instant::now();
        let r = handshake(a, false, &identity("dev-b"), &[k]).await;
        assert!(matches!(r, Err(HandshakeError::Timeout)));
        assert!(started.elapsed() >= HANDSHAKE_TIMEOUT);
    }

    #[tokio::test]
    async fn garbage_first_bytes_error_without_panic() {
        let k = derive_auth_key(&[1; 32]);
        for initiator in [true, false] {
            for _ in 0..16 {
                let (a, mut b) = duplex(64 * 1024);
                let mut garbage = [0u8; 64];
                rand::Rng::fill(&mut rand::thread_rng(), &mut garbage[..]);
                b.write_all(&garbage).await.unwrap();
                b.shutdown().await.unwrap();
                let r = handshake(a, initiator, &identity("dev-a"), &[k]).await;
                assert!(matches!(
                    r,
                    Err(HandshakeError::Noise(_) | HandshakeError::Protocol(_))
                ));
            }
        }
    }

    fn chunk() -> impl proptest::strategy::Strategy<Value = Vec<u8>> {
        use proptest::prelude::*;
        prop_oneof![
            proptest::collection::vec(any::<u8>(), 0..512),
            (
                0u32..1024,
                any::<u8>(),
                proptest::collection::vec(any::<u8>(), 0..512)
            )
                .prop_map(|(len, kind, body)| [&len.to_be_bytes()[..], &[kind], &body].concat()),
        ]
    }

    proptest::proptest! {
        #![proptest_config(proptest::prelude::ProptestConfig::with_cases(64))]
        #[test]
        fn anonymous_session_chunks_end_in_an_error(chunks in proptest::collection::vec(chunk(), 0..8)) {
            let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
            rt.block_on(async {
                let keys = [derive_auth_key(&[1; 32])];
                let me = identity("dev-b");
                let (a, b) = duplex(64 * 1024);
                let rogue = async {
                    let mut s = noise(a, true).await.unwrap();
                    for c in &chunks {
                        if s.writer.send_raw(c).await.is_err() {
                            break;
                        }
                    }
                };
                let responder = tokio::time::timeout(HANDSHAKE_TIMEOUT * 2, handshake(b, false, &me, &keys));
                let (_, outcome) = tokio::join!(rogue, responder);
                assert!(matches!(outcome, Ok(Err(_))), "{:?}", outcome.map(|r| r.map(|_| ())));
            });
        }
    }

    #[tokio::test]
    async fn session_roundtrips_blob() {
        let k = derive_auth_key(&[1; 32]);
        let (a, b) = pair(&[k], &[k]).await;
        let (mut a, mut b) = (a.ok().unwrap().0, b.ok().unwrap().0);
        let blob: Vec<u8> = (0..1_000_000u32).map(|i| i as u8).collect();
        let sent = Frame::Blob(blob);
        let (sr, rr) = tokio::join!(a.send(&sent), b.recv());
        sr.unwrap();
        assert_eq!(rr.unwrap(), sent);
        b.send(&Frame::Nudge).await.unwrap();
        assert_eq!(a.recv().await.unwrap(), Frame::Nudge);
    }

    #[tokio::test]
    async fn split_halves_work_concurrently() {
        let k = derive_auth_key(&[1; 32]);
        let (a, b) = pair(&[k], &[k]).await;
        let (mut ar, mut aw) = a.ok().unwrap().0.split();
        let (mut br, mut bw) = b.ok().unwrap().0.split();
        let big = Frame::Blob(vec![9; 300_000]);
        let (x, y, ra, rb) = tokio::join!(aw.send(&big), bw.send(&big), ar.recv(), br.recv());
        x.unwrap();
        y.unwrap();
        assert_eq!(ra.unwrap(), big);
        assert_eq!(rb.unwrap(), big);
    }

    #[tokio::test]
    async fn oversized_frame_header_is_rejected() {
        let k = derive_auth_key(&[1; 32]);
        let (a, b) = pair(&[k], &[k]).await;
        let (mut a, mut b) = (a.ok().unwrap().0, b.ok().unwrap().0);
        a.writer
            .send_raw(&((MAX_FRAME as u32 + 1).to_be_bytes()))
            .await
            .unwrap();
        assert!(matches!(
            b.recv().await,
            Err(HandshakeError::Protocol(ProtocolError::TooLarge(_)))
        ));
    }

    #[tokio::test(start_paused = true)]
    async fn keepalives_are_invisible_and_idle_reader_times_out() {
        let k = derive_auth_key(&[1; 32]);
        let (a, b) = pair(&[k], &[k]).await;
        let (_, mut aw) = a.ok().unwrap().0.split();
        let (mut br, _bw) = b.ok().unwrap().0.split();
        br.set_idle_timeout(Duration::from_secs(5));
        aw.keepalive().await.unwrap();
        aw.keepalive().await.unwrap();
        aw.send(&Frame::Nudge).await.unwrap();
        assert_eq!(br.recv().await.unwrap(), Frame::Nudge);
        aw.keepalive().await.unwrap();
        let started = tokio::time::Instant::now();
        assert!(matches!(br.recv().await, Err(HandshakeError::Timeout)));
        assert!(started.elapsed() >= Duration::from_secs(5));
    }

    #[tokio::test(start_paused = true)]
    async fn stalled_write_times_out() {
        let k = derive_auth_key(&[1; 32]);
        let (a, _b) = pair(&[k], &[k]).await;
        let (_, mut aw) = a.ok().unwrap().0.split();
        aw.set_write_timeout(Duration::from_secs(5));
        let r = aw.send(&Frame::Blob(vec![1; 1_000_000])).await;
        assert!(matches!(r, Err(HandshakeError::Timeout)));
    }

    async fn paired(
        initiator: Mode<'_>,
        responder: Mode<'_>,
    ) -> (
        Result<Handshake, HandshakeError>,
        Result<Handshake, HandshakeError>,
    ) {
        let (a, b) = duplex(64 * 1024);
        let (ia, ib) = (identity("dev-a"), identity("dev-b"));
        tokio::join!(
            handshake_with(a, true, &ia, initiator),
            handshake_with(b, false, &ib, responder)
        )
    }

    #[tokio::test]
    async fn pair_handshake_gives_both_sides_the_same_sas() {
        let (a, b) = paired(
            Mode::Pair,
            Mode::Accept {
                keys: &[derive_auth_key(&[1; 32])],
                pairing: true,
            },
        )
        .await;
        let (a, b) = (a.ok().unwrap(), b.ok().unwrap());
        assert_eq!(a.sas, b.sas);
        assert!(a.sas.unwrap() < 1_000_000);
        assert_eq!((a.matched, b.matched), (None, None));
        assert_eq!(a.peer.device_id, "dev-b");
        assert_eq!(b.peer.device_id, "dev-a");
    }

    #[tokio::test]
    async fn pair_refused_when_window_closed() {
        let (a, b) = paired(
            Mode::Pair,
            Mode::Accept {
                keys: &[derive_auth_key(&[1; 32])],
                pairing: false,
            },
        )
        .await;
        assert!(matches!(a, Err(HandshakeError::NotTrusted)));
        assert!(matches!(b, Err(HandshakeError::PairingClosed)));
    }

    #[tokio::test]
    async fn matched_reports_the_verifying_key_index() {
        let (k1, k2) = (derive_auth_key(&[1; 32]), derive_auth_key(&[2; 32]));
        let (a, b) = paired(
            Mode::Keys(&[k2]),
            Mode::Accept {
                keys: &[k1, k2],
                pairing: true,
            },
        )
        .await;
        let (a, b) = (a.ok().unwrap(), b.ok().unwrap());
        assert_eq!((a.matched, b.matched), (Some(0), Some(1)));
        assert_eq!((a.sas, b.sas), (None, None));
    }

    #[tokio::test]
    async fn pair_flag_with_proofs_is_still_pair_only() {
        let keys = [derive_auth_key(&[1; 32])];
        let me = identity("dev-b");
        let sneaky = |hash: &[u8]| Auth {
            version: PROTOCOL_VERSION,
            proofs: vec![proof(&keys[0], hash, true)],
            pair: true,
            ..Default::default()
        };
        let (a, b) = duplex(64 * 1024);
        let (seen, real) = tokio::join!(
            rogue_initiator(a, sneaky),
            handshake_with(
                b,
                false,
                &me,
                Mode::Accept {
                    keys: &keys,
                    pairing: false
                }
            )
        );
        assert!(matches!(real, Err(HandshakeError::PairingClosed)));
        assert_eq!(seen, vec![Frame::Bye]);
    }

    #[tokio::test]
    async fn key_initiator_refuses_a_pair_reply() {
        let keys = [derive_auth_key(&[1; 32])];
        let (a, b) = duplex(64 * 1024);
        let ia = identity("dev-a");
        let (real, _) = tokio::join!(
            handshake_with(a, true, &ia, Mode::Keys(&keys)),
            rogue_responder(b, |_| Auth {
                version: PROTOCOL_VERSION,
                proofs: vec![],
                pair: true,
                ..Default::default()
            })
        );
        assert!(matches!(real, Err(HandshakeError::NotTrusted)));
    }

    #[tokio::test]
    async fn pair_initiator_refuses_a_key_reply() {
        let (a, b) = duplex(64 * 1024);
        let ia = identity("dev-a");
        let (real, _) = tokio::join!(
            handshake_with(a, true, &ia, Mode::Pair),
            rogue_responder(b, |_| keyless())
        );
        assert!(matches!(real, Err(HandshakeError::NotTrusted)));
    }

    #[test]
    fn sas_is_stable() {
        let (h, na, nb) = ([7u8; 32], [1u8; 32], [2u8; 32]);
        assert_eq!(sas(&h, &na, &nb), sas(&h, &na, &nb));
        assert_ne!(sas(&h, &na, &nb), sas(&h, &nb, &na));
        assert_ne!(sas(&h, &na, &nb), sas(&[8u8; 32], &na, &nb));
        assert_eq!(sas(&[0u8; 32], &[0u8; 32], &[0u8; 32]), 510_912);
    }

    async fn rogue_pair_initiator<S>(
        stream: S,
        reveal: impl FnOnce(&[u8; 32]) -> [u8; 32],
    ) -> Vec<Frame>
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let mut s = noise(stream, true).await.unwrap();
        let hash = s.handshake_hash().to_vec();
        let na = [5u8; 32];
        s.send(&pair_auth(Some(sas_commit(&hash, &na)), None))
            .await
            .unwrap();
        let seen = vec![s.recv().await.unwrap(), s.recv().await.unwrap()];
        let _ = s.send(&pair_auth(None, Some(reveal(&na)))).await;
        let _ = s
            .send(&Frame::Hello(hello(&identity("dev-a"), &hash, true)))
            .await;
        drain(s, seen).await
    }

    #[tokio::test]
    async fn sas_commit_mismatch_is_refused() {
        let me = identity("dev-b");
        let keys = [derive_auth_key(&[1; 32])];
        let (a, b) = duplex(64 * 1024);
        let (seen, real) = tokio::join!(
            rogue_pair_initiator(a, |_| [6u8; 32]),
            handshake_with(
                b,
                false,
                &me,
                Mode::Accept {
                    keys: &keys,
                    pairing: true
                }
            )
        );
        assert!(matches!(real, Err(HandshakeError::NotTrusted)));
        assert_eq!(seen.last(), Some(&Frame::Bye));
    }

    #[tokio::test]
    async fn pair_replies_never_carry_key_proofs() {
        let me = identity("dev-b");
        let keys = [derive_auth_key(&[1; 32])];
        let (a, b) = duplex(64 * 1024);
        let (seen, real) = tokio::join!(
            rogue_pair_initiator(a, |na| *na),
            handshake_with(
                b,
                false,
                &me,
                Mode::Accept {
                    keys: &keys,
                    pairing: true
                }
            )
        );
        assert!(real.is_ok());
        let Frame::Auth(reply) = &seen[0] else {
            panic!("responder opened with {:?}", seen[0]);
        };
        assert!(reply.pair && reply.proofs.is_empty() && reply.nonce.is_some());
    }

    #[tokio::test]
    async fn fresh_nonces_give_fresh_codes() {
        let run = || async {
            paired(
                Mode::Pair,
                Mode::Accept {
                    keys: &[],
                    pairing: true,
                },
            )
            .await
            .0
            .ok()
            .unwrap()
            .sas
            .unwrap()
        };
        let codes = [run().await, run().await, run().await];
        assert!(codes[0] != codes[1] || codes[1] != codes[2]);
    }
}
