use super::identity::LocalIdentity;
use super::protocol::{
    decode, encode, write_frame, Auth, Frame, Hello, ProtocolError, MAX_FRAME, PROTOCOL_VERSION,
};
use hmac::{Hmac, Mac};
use sha2::Sha256;
use snow::StatelessTransportState;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite};

const NOISE_PARAMS: &str = "Noise_NN_25519_ChaChaPoly_BLAKE2s";
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
const NOISE_MAX: usize = 65535;
const MAX_CHUNK: usize = NOISE_MAX - 16;
const MAX_PROOFS: usize = 16;
const PREAUTH_MAX: usize = 64 * 1024;

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
}

pub struct SessionWriter {
    io: Box<dyn AsyncWrite + Send + Unpin>,
    noise: Arc<StatelessTransportState>,
    nonce: u64,
}

pub struct Session {
    reader: SessionReader,
    writer: SessionWriter,
    hash: Vec<u8>,
}

async fn read_msg<R: AsyncRead + Unpin>(io: &mut R, buf: &mut [u8]) -> std::io::Result<usize> {
    let mut len = [0u8; 2];
    io.read_exact(&mut len).await?;
    let len = u16::from_be_bytes(len) as usize;
    io.read_exact(&mut buf[..len]).await?;
    Ok(len)
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

fn next_nonce(nonce: &mut u64) -> u64 {
    let n = *nonce;
    *nonce += 1;
    n
}

impl SessionReader {
    async fn open_next(&mut self) -> Result<usize, HandshakeError> {
        let n = read_msg(&mut self.io, &mut self.sealed).await?;
        let nonce = next_nonce(&mut self.nonce);
        Ok(self
            .noise
            .read_message(nonce, &self.sealed[..n], &mut self.plain)?)
    }

    pub async fn recv(&mut self) -> Result<Frame, HandshakeError> {
        self.recv_max(MAX_FRAME).await
    }

    pub async fn recv_max(&mut self, limit: usize) -> Result<Frame, HandshakeError> {
        let n = self.open_next().await?;
        let (prefix, rest) = self.plain[..n]
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
    pub async fn send(&mut self, f: &Frame) -> Result<(), HandshakeError> {
        self.send_raw(&encode(f)?).await
    }

    async fn send_raw(&mut self, bytes: &[u8]) -> Result<(), HandshakeError> {
        let mut wire = Vec::with_capacity(bytes.len() + NOISE_MAX);
        for chunk in bytes.chunks(MAX_CHUNK) {
            let nonce = next_nonce(&mut self.nonce);
            push_msg(&mut wire, |out| self.noise.write_message(nonce, chunk, out))?;
        }
        Ok(write_frame(&mut self.io, &wire).await?)
    }
}

impl Session {
    pub async fn send(&mut self, f: &Frame) -> Result<(), HandshakeError> {
        self.writer.send(f).await
    }

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
}

async fn noise<S: AsyncRead + AsyncWrite + Unpin + Send + 'static>(
    mut stream: S,
    initiator: bool,
) -> Result<(Session, Vec<u8>), HandshakeError> {
    let builder = snow::Builder::new(NOISE_PARAMS.parse()?);
    let mut hs = if initiator {
        builder.build_initiator()?
    } else {
        builder.build_responder()?
    };
    let mut sealed = vec![0u8; NOISE_MAX];
    let mut plain = vec![0u8; NOISE_MAX];
    while !hs.is_handshake_finished() {
        if hs.is_my_turn() {
            let mut wire = Vec::new();
            push_msg(&mut wire, |out| hs.write_message(&[], out))?;
            write_frame(&mut stream, &wire).await?;
        } else {
            let n = read_msg(&mut stream, &mut sealed).await?;
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
        },
        writer: SessionWriter {
            io: Box::new(w),
            noise,
            nonce: 0,
        },
        hash: hash.clone(),
    };
    Ok((session, hash))
}

// The role byte stops a keyless peer from reflecting our own proofs back at us.
fn mac(auth_key: &[u8; 32], handshake_hash: &[u8], initiator: bool) -> Hmac<Sha256> {
    let mut m = Hmac::<Sha256>::new_from_slice(auth_key).expect("HMAC takes any key length");
    m.update(&[u8::from(initiator)]);
    m.update(handshake_hash);
    m
}

fn proof(auth_key: &[u8; 32], handshake_hash: &[u8], initiator: bool) -> [u8; 32] {
    mac(auth_key, handshake_hash, initiator)
        .finalize()
        .into_bytes()
        .into()
}

fn verify(
    peer: &Auth,
    peer_is_initiator: bool,
    auth_keys: &[[u8; 32]],
    hash: &[u8],
) -> Result<(), HandshakeError> {
    let trusted = peer.proofs.len() <= MAX_PROOFS
        && auth_keys.iter().any(|k| {
            peer.proofs
                .iter()
                .any(|p| mac(k, hash, peer_is_initiator).verify_slice(p).is_ok())
        });
    if !trusted {
        return Err(HandshakeError::NotTrusted);
    }
    if peer.version != PROTOCOL_VERSION {
        return Err(HandshakeError::VersionMismatch(peer.version));
    }
    Ok(())
}

async fn recv_preauth(session: &mut Session) -> Result<Frame, HandshakeError> {
    match session.recv_max(PREAUTH_MAX).await? {
        Frame::Bye => Err(HandshakeError::NotTrusted),
        f => Ok(f),
    }
}

async fn authenticate(
    session: &mut Session,
    initiator: bool,
    me: &LocalIdentity,
    auth_keys: &[[u8; 32]],
    hash: &[u8],
) -> Result<Hello, HandshakeError> {
    let my_auth = Frame::Auth(Auth {
        version: PROTOCOL_VERSION,
        proofs: auth_keys
            .iter()
            .map(|k| proof(k, hash, initiator))
            .collect(),
    });
    let my_hello = Frame::Hello(Hello {
        device_id: me.device_id.clone(),
        device_name: me.device_name.clone(),
        platform: me.platform.clone(),
        device_key: me.key.public,
    });
    if initiator {
        session.send(&my_auth).await?;
    }
    let Frame::Auth(peer_auth) = recv_preauth(session).await? else {
        return Err(malformed("expected auth"));
    };
    if let Err(e) = verify(&peer_auth, !initiator, auth_keys, hash) {
        let _ = session.send(&Frame::Bye).await;
        return Err(e);
    }
    if !initiator {
        session.send(&my_auth).await?;
        session.send(&my_hello).await?;
    }
    let Frame::Hello(peer) = recv_preauth(session).await? else {
        return Err(malformed("expected hello"));
    };
    if initiator {
        session.send(&my_hello).await?;
    }
    Ok(peer)
}

pub async fn handshake<S: AsyncRead + AsyncWrite + Unpin + Send + 'static>(
    stream: S,
    initiator: bool,
    me: &LocalIdentity,
    auth_keys: &[[u8; 32]],
) -> Result<(Session, Hello), HandshakeError> {
    let run = async {
        let (mut session, hash) = noise(stream, initiator).await?;
        let peer = authenticate(&mut session, initiator, me, auth_keys, &hash).await?;
        Ok((session, peer))
    };
    tokio::time::timeout(HANDSHAKE_TIMEOUT, run)
        .await
        .map_err(|_| HandshakeError::Timeout)?
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

    fn peer(o: &Outcome) -> &Hello {
        &o.as_ref().map_err(|e| e.to_string()).unwrap().1
    }

    fn keyless() -> Auth {
        Auth {
            version: PROTOCOL_VERSION,
            proofs: vec![[0xAB; 32]],
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
        let (mut s, hash) = noise(stream, true).await.unwrap();
        s.send(&Frame::Auth(auth(&hash))).await.unwrap();
        drain(s, vec![]).await
    }

    async fn rogue_responder<S>(stream: S, reply: impl FnOnce(&Auth) -> Auth) -> Vec<Frame>
    where
        S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
    {
        let (mut s, _) = noise(stream, false).await.unwrap();
        let first = s.recv().await.unwrap();
        let Frame::Auth(auth) = &first else {
            panic!("initiator opened with {first:?}");
        };
        s.send(&Frame::Auth(reply(auth))).await.unwrap();
        drain(s, vec![first]).await
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
        let rogue = async {
            let (mut s, _) = noise(a, true).await.unwrap();
            let claim = (PREAUTH_MAX as u32 + 1).to_be_bytes();
            s.writer.send_raw(&claim).await.unwrap();
            s
        };
        let (_rogue, real) = tokio::join!(rogue, handshake(b, false, &me, &keys));
        assert!(matches!(
            real,
            Err(HandshakeError::Protocol(ProtocolError::TooLarge(n))) if n == PREAUTH_MAX + 1
        ));
    }

    #[tokio::test(start_paused = true)]
    async fn silent_peer_times_out() {
        let k = derive_auth_key(&[1; 32]);
        for initiator in [true, false] {
            let (a, _silent) = duplex(64 * 1024);
            let started = tokio::time::Instant::now();
            let r = handshake(a, initiator, &identity("dev-a"), &[k]).await;
            assert!(matches!(r, Err(HandshakeError::Timeout)));
            assert!(started.elapsed() >= std::time::Duration::from_secs(10));
        }
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
}
