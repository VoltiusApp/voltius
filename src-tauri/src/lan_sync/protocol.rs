use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use tokio::io::{AsyncWrite, AsyncWriteExt};

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_FRAME: usize = 16 * 1024 * 1024;

const KIND_HELLO: u8 = 1;
const KIND_BLOB: u8 = 2;
const KIND_NUDGE: u8 = 3;
const KIND_BYE: u8 = 4;
const KIND_AUTH: u8 = 5;
const KIND_CAPS: u8 = 6;
const KIND_FILES: u8 = 7;
const KIND_FILES_REPLY: u8 = 8;
const GRANT_LEN: usize = 64;
const KIND_PAIR: u8 = 9;
const KIND_GROUP: u8 = 10;
const KIND_PRESENCE: u8 = 11;
const KIND_ADDRS: u8 = 12;
const MAX_ADDRS_FRAME: usize = 4 * 1024;

pub const MAX_EPOCHS: usize = 16;
const SECRET_HEX_LEN: usize = 64;
const MAX_GROUP_ID_LEN: usize = 64;
const MAX_HOST_NAME_LEN: usize = 128;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Hello {
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub device_key: [u8; 32],
    pub device_sig: Vec<u8>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub addrs: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub features: Vec<String>,
}

pub const MAX_HELLO_ADDRS: usize = 16;
pub const FEATURES: &[&str] = &[];

pub fn wire_addrs(addrs: &[SocketAddr]) -> Vec<String> {
    addrs
        .iter()
        .take(MAX_HELLO_ADDRS)
        .map(SocketAddr::to_string)
        .collect()
}

impl Hello {
    pub fn peer_addrs(&self) -> Vec<SocketAddr> {
        super::addrs::sanitize(&self.addrs)
    }
}

#[cfg(test)]
pub(super) fn raw_hello_frame(json: &str) -> Vec<u8> {
    let len = (json.len() as u32 + 1).to_be_bytes();
    [&len[..], &[KIND_HELLO], json.as_bytes()].concat()
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct Auth {
    pub version: u16,
    pub proofs: Vec<[u8; 32]>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pair: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit: Option<[u8; 32]>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nonce: Option<[u8; 32]>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PairInfo {
    pub mode: String,
    pub group: Option<String>,
    pub entities: u32,
    pub members: u16,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub reverify: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "t", rename_all = "camelCase")]
pub enum Pair {
    Info(PairInfo),
    Confirm,
    Cancel,
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EpochSecret {
    pub epoch: u32,
    pub secret: String,
}

impl std::fmt::Debug for EpochSecret {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("EpochSecret")
            .field("epoch", &self.epoch)
            .finish_non_exhaustive()
    }
}

#[derive(Serialize, Deserialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GroupGrant {
    pub group_id: String,
    pub vault_key: String,
    pub secrets: Vec<EpochSecret>,
    pub host_name: String,
}

impl std::fmt::Debug for GroupGrant {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GroupGrant")
            .field("group_id", &self.group_id)
            .field("secrets", &self.secrets)
            .field("host_name", &self.host_name)
            .finish_non_exhaustive()
    }
}

fn is_secret_hex(s: &str) -> bool {
    s.len() == SECRET_HEX_LEN && s.bytes().all(|b| b.is_ascii_hexdigit())
}

impl GroupGrant {
    pub(super) fn validate(&self) -> Result<(), ProtocolError> {
        let ok = is_secret_hex(&self.vault_key)
            && (1..=MAX_EPOCHS).contains(&self.secrets.len())
            && self.secrets.iter().all(|s| is_secret_hex(&s.secret))
            && self.group_id.len() <= MAX_GROUP_ID_LEN
            && self.host_name.len() <= MAX_HOST_NAME_LEN;
        ok.then_some(())
            .ok_or_else(|| ProtocolError::Malformed("invalid group grant".into()))
    }
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum PresenceState {
    Live,
    Paused,
    Moved,
    Left,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Presence {
    pub state: PresenceState,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Caps {
    pub files: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Default)]
pub struct FilesRequest {
    pub grant: Option<String>,
    #[serde(default)]
    pub reopen: bool,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Refusal {
    Off,
    Denied,
    TimedOut,
    Busy,
    Expired,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "result", rename_all = "camelCase")]
pub enum FilesReply {
    #[serde(rename_all = "camelCase")]
    Accepted {
        read_only: bool,
        grant: Option<String>,
    },
    Refused {
        reason: Refusal,
    },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Addrs {
    pub addrs: Vec<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Frame {
    Hello(Hello),
    Auth(Auth),
    Caps(Caps),
    Files(FilesRequest),
    FilesReply(FilesReply),
    Blob(Vec<u8>),
    Addrs(Addrs),
    Nudge,
    Bye,
    Pair(Pair),
    Group(GroupGrant),
    Presence(Presence),
    Unknown(u8),
}

#[derive(thiserror::Error, Debug)]
pub enum ProtocolError {
    #[error("frame of {0} bytes exceeds the limit")]
    TooLarge(usize),
    #[error("unknown frame kind {0}")]
    UnknownKind(u8),
    #[error("malformed frame: {0}")]
    Malformed(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

fn to_json<T: Serialize>(v: &T) -> Result<Vec<u8>, ProtocolError> {
    serde_json::to_vec(v).map_err(|e| ProtocolError::Malformed(e.to_string()))
}

fn from_json<T: serde::de::DeserializeOwned>(payload: &[u8]) -> Result<T, ProtocolError> {
    serde_json::from_slice(payload).map_err(|e| ProtocolError::Malformed(e.to_string()))
}

fn check_grant(grant: Option<&String>) -> Result<(), ProtocolError> {
    match grant {
        Some(g)
            if g.len() != GRANT_LEN
                || !g.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')) =>
        {
            Err(ProtocolError::Malformed("invalid grant".into()))
        }
        _ => Ok(()),
    }
}

trait Json {
    fn json(&self) -> Result<Vec<u8>, ProtocolError>;
}

impl<T: Serialize> Json for T {
    fn json(&self) -> Result<Vec<u8>, ProtocolError> {
        to_json(self)
    }
}

enum Payload<'a> {
    Json(&'a dyn Json),
    Raw(&'a [u8]),
}

impl Frame {
    fn parts(&self) -> (u8, Option<Payload<'_>>) {
        let (kind, payload) = match self {
            Frame::Hello(h) => (KIND_HELLO, Payload::Json(h)),
            Frame::Auth(a) => (KIND_AUTH, Payload::Json(a)),
            Frame::Caps(c) => (KIND_CAPS, Payload::Json(c)),
            Frame::Files(r) => (KIND_FILES, Payload::Json(r)),
            Frame::FilesReply(r) => (KIND_FILES_REPLY, Payload::Json(r)),
            Frame::Blob(b) => (KIND_BLOB, Payload::Raw(b)),
            Frame::Addrs(a) => (KIND_ADDRS, Payload::Json(a)),
            Frame::Nudge => (KIND_NUDGE, Payload::Raw(&[])),
            Frame::Bye => (KIND_BYE, Payload::Raw(&[])),
            Frame::Pair(p) => (KIND_PAIR, Payload::Json(p)),
            Frame::Group(g) => (KIND_GROUP, Payload::Json(g)),
            Frame::Presence(p) => (KIND_PRESENCE, Payload::Json(p)),
            Frame::Unknown(kind) => return (*kind, None),
        };
        (kind, Some(payload))
    }

    pub fn kind(&self) -> u8 {
        self.parts().0
    }
}

pub fn encode(frame: &Frame) -> Result<Vec<u8>, ProtocolError> {
    let (kind, payload) = frame.parts();
    let payload = match payload {
        Some(Payload::Json(v)) => v.json()?,
        Some(Payload::Raw(b)) => b.to_vec(),
        None => return Err(ProtocolError::UnknownKind(kind)),
    };
    let len = payload.len() + 1;
    if len > MAX_FRAME {
        return Err(ProtocolError::TooLarge(len));
    }
    let mut out = Vec::with_capacity(4 + len);
    out.extend_from_slice(&(len as u32).to_be_bytes());
    out.push(kind);
    out.extend_from_slice(&payload);
    Ok(out)
}

pub fn decode(buf: &[u8]) -> Result<Frame, ProtocolError> {
    let (&kind, payload) = buf
        .split_first()
        .ok_or_else(|| ProtocolError::Malformed("empty frame".into()))?;
    match kind {
        KIND_HELLO => from_json(payload).map(Frame::Hello),
        KIND_AUTH => from_json(payload).map(Frame::Auth),
        KIND_CAPS => from_json(payload).map(Frame::Caps),
        KIND_FILES => {
            let req: FilesRequest = from_json(payload)?;
            check_grant(req.grant.as_ref())?;
            Ok(Frame::Files(req))
        }
        KIND_FILES_REPLY => {
            let reply: FilesReply = from_json(payload)?;
            if let FilesReply::Accepted { grant, .. } = &reply {
                check_grant(grant.as_ref())?;
            }
            Ok(Frame::FilesReply(reply))
        }
        KIND_BLOB => Ok(Frame::Blob(payload.to_vec())),
        KIND_ADDRS if payload.len() > MAX_ADDRS_FRAME => {
            Err(ProtocolError::Malformed("addresses frame too large".into()))
        }
        KIND_ADDRS => from_json(payload).map(Frame::Addrs),
        KIND_NUDGE | KIND_BYE if !payload.is_empty() => {
            Err(ProtocolError::Malformed("unexpected payload".into()))
        }
        KIND_NUDGE => Ok(Frame::Nudge),
        KIND_BYE => Ok(Frame::Bye),
        KIND_PAIR => from_json(payload).map(Frame::Pair),
        KIND_GROUP => {
            let grant: GroupGrant = from_json(payload)?;
            grant.validate()?;
            Ok(Frame::Group(grant))
        }
        KIND_PRESENCE => from_json(payload).map(Frame::Presence),
        other => Ok(Frame::Unknown(other)),
    }
}

pub async fn write_frame<W: AsyncWrite + Unpin>(
    w: &mut W,
    bytes: &[u8],
) -> Result<(), ProtocolError> {
    w.write_all(bytes).await?;
    w.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use tokio::io::{AsyncRead, AsyncReadExt};

    async fn read_frame<R: AsyncRead + Unpin>(r: &mut R) -> Result<Vec<u8>, ProtocolError> {
        let mut prefix = [0u8; 4];
        r.read_exact(&mut prefix).await?;
        let len = u32::from_be_bytes(prefix) as usize;
        if len > MAX_FRAME {
            return Err(ProtocolError::TooLarge(len));
        }
        let mut buf = vec![0u8; len];
        r.read_exact(&mut buf).await?;
        Ok(buf)
    }

    fn sample_hello() -> Hello {
        Hello {
            device_id: "dev-1".into(),
            device_name: "Laptop".into(),
            platform: "linux".into(),
            device_key: [3u8; 32],
            device_sig: vec![4u8; 64],
            addrs: vec![],
            features: vec![],
        }
    }

    fn part1_json() -> String {
        serde_json::to_string(&serde_json::json!({
            "device_id": "dev-1", "device_name": "Laptop", "platform": "linux",
            "device_key": vec![3u8; 32], "device_sig": vec![4u8; 64],
        }))
        .unwrap()
    }

    #[test]
    fn old_hello_json_decodes() {
        let Frame::Hello(h) =
            decode(&[&[KIND_HELLO][..], part1_json().as_bytes()].concat()).unwrap()
        else {
            panic!("not a hello")
        };
        assert!(h.addrs.is_empty() && h.features.is_empty());
        assert_eq!(h, sample_hello());
    }

    #[test]
    fn unknown_hello_fields_are_ignored() {
        let mut v: serde_json::Value = serde_json::from_str(&part1_json()).unwrap();
        v["future"] = serde_json::json!({"x": 1});
        let payload = [&[KIND_HELLO][..], v.to_string().as_bytes()].concat();
        assert!(matches!(decode(&payload).unwrap(), Frame::Hello(_)));
    }

    #[test]
    fn empty_extensions_are_not_serialised() {
        let wire = encode(&Frame::Hello(sample_hello())).unwrap();
        let json: serde_json::Value = serde_json::from_slice(&wire[5..]).unwrap();
        assert!(json.get("addrs").is_none() && json.get("features").is_none());
        assert_eq!(
            json,
            serde_json::from_str::<serde_json::Value>(&part1_json()).unwrap()
        );
    }

    #[test]
    fn caps_with_legacy_port_still_decodes() {
        for json in [&br#"{"files":true}"#[..], br#"{"files":true,"port":47391}"#] {
            let buf = [&[KIND_CAPS][..], json].concat();
            assert_eq!(decode(&buf).unwrap(), Frame::Caps(Caps { files: true }));
        }
    }

    #[test]
    fn old_auth_json_without_pair_decodes() {
        let auth: Auth = serde_json::from_str(r#"{"version":1,"proofs":[]}"#).unwrap();
        assert!(!auth.pair);
        let json = serde_json::to_value(&auth).unwrap();
        assert!(json.get("pair").is_none());
        assert!(auth.commit.is_none() && auth.nonce.is_none());
        assert!(json.get("commit").is_none() && json.get("nonce").is_none());
    }

    #[test]
    fn roundtrip_every_kind() {
        for f in [
            Frame::Hello(sample_hello()),
            Frame::Auth(Auth {
                version: PROTOCOL_VERSION,
                proofs: vec![[7u8; 32], [9u8; 32]],
                pair: false,
                commit: Some([3u8; 32]),
                nonce: Some([4u8; 32]),
            }),
            Frame::Caps(Caps { files: true }),
            Frame::Caps(Caps { files: false }),
            Frame::Files(FilesRequest::default()),
            Frame::Files(FilesRequest {
                grant: Some("ab".repeat(32)),
                reopen: true,
            }),
            Frame::FilesReply(FilesReply::Accepted {
                read_only: true,
                grant: None,
            }),
            Frame::FilesReply(FilesReply::Accepted {
                read_only: false,
                grant: Some("0f".repeat(32)),
            }),
            Frame::FilesReply(FilesReply::Refused {
                reason: Refusal::Off,
            }),
            Frame::FilesReply(FilesReply::Refused {
                reason: Refusal::Denied,
            }),
            Frame::FilesReply(FilesReply::Refused {
                reason: Refusal::TimedOut,
            }),
            Frame::FilesReply(FilesReply::Refused {
                reason: Refusal::Busy,
            }),
            Frame::FilesReply(FilesReply::Refused {
                reason: Refusal::Expired,
            }),
            Frame::Blob(vec![1, 2, 3]),
            Frame::Nudge,
            Frame::Bye,
        ] {
            let wire = encode(&f).unwrap();
            let len = u32::from_be_bytes(wire[..4].try_into().unwrap()) as usize;
            assert_eq!(len, wire.len() - 4);
            assert_eq!(decode(&wire[4..]).unwrap(), f);
        }
    }

    fn files_wire(grant: &str) -> Vec<u8> {
        let mut buf = vec![KIND_FILES];
        buf.extend_from_slice(format!(r#"{{"grant":"{grant}"}}"#).as_bytes());
        buf
    }

    #[test]
    fn files_request_without_reopen_still_decodes() {
        let buf = files_wire(&"a".repeat(64));
        assert_eq!(
            decode(&buf).unwrap(),
            Frame::Files(FilesRequest {
                grant: Some("a".repeat(64)),
                reopen: false,
            })
        );
    }

    #[test]
    fn files_request_rejects_oversized_grant() {
        let buf = files_wire(&"a".repeat(65));
        assert!(matches!(decode(&buf), Err(ProtocolError::Malformed(_))));
    }

    #[test]
    fn files_request_rejects_non_hex_grant() {
        let buf = files_wire(&"g".repeat(64));
        assert!(matches!(decode(&buf), Err(ProtocolError::Malformed(_))));
    }

    #[test]
    fn files_reply_rejects_bad_grant() {
        let mut buf = vec![KIND_FILES_REPLY];
        buf.extend_from_slice(br#"{"result":"accepted","readOnly":true,"grant":"abc"}"#);
        assert!(matches!(decode(&buf), Err(ProtocolError::Malformed(_))));
    }

    #[test]
    fn files_reply_wire_shape() {
        let json = serde_json::to_string(&FilesReply::Refused {
            reason: Refusal::TimedOut,
        })
        .unwrap();
        assert_eq!(json, r#"{"result":"refused","reason":"timedOut"}"#);
    }

    fn sample_grant() -> GroupGrant {
        GroupGrant {
            group_id: "g1".into(),
            vault_key: "ab".repeat(32),
            secrets: vec![
                EpochSecret {
                    epoch: 2,
                    secret: "cd".repeat(32),
                },
                EpochSecret {
                    epoch: 1,
                    secret: "ef".repeat(32),
                },
            ],
            host_name: "Laptop".into(),
        }
    }

    #[test]
    fn debug_never_prints_key_material() {
        let shown = format!("{:?}", Frame::Group(sample_grant()));
        for hex in ["ab", "cd", "ef"] {
            assert!(!shown.contains(&hex.repeat(32)), "{shown}");
        }
        assert!(shown.contains("g1") && shown.contains("Laptop"), "{shown}");
    }

    fn group_payload(g: &GroupGrant) -> Vec<u8> {
        [&[KIND_GROUP][..], &serde_json::to_vec(g).unwrap()].concat()
    }

    #[test]
    fn pair_group_presence_roundtrip() {
        for f in [
            Frame::Pair(Pair::Info(PairInfo {
                mode: "none".into(),
                group: Some("g1".into()),
                entities: 12,
                members: 3,
                reverify: true,
            })),
            Frame::Pair(Pair::Confirm),
            Frame::Pair(Pair::Cancel),
            Frame::Group(sample_grant()),
            Frame::Presence(Presence {
                state: PresenceState::Paused,
            }),
            Frame::Presence(Presence {
                state: PresenceState::Moved,
            }),
            Frame::Presence(Presence {
                state: PresenceState::Left,
            }),
        ] {
            let wire = encode(&f).unwrap();
            assert_eq!(decode(&wire[4..]).unwrap(), f);
        }
        let wire = encode(&Frame::Group(sample_grant())).unwrap();
        let json: serde_json::Value = serde_json::from_slice(&wire[5..]).unwrap();
        assert!(json.get("groupId").is_some() && json.get("vaultKey").is_some());
        assert!(json.get("hostName").is_some());
        let wire = encode(&Frame::Pair(Pair::Confirm)).unwrap();
        assert_eq!(&wire[5..], br#"{"t":"confirm"}"#);
    }

    #[test]
    fn group_grant_rejects_bad_hex_and_too_many_secrets() {
        let reject = |g: GroupGrant| {
            assert!(matches!(
                decode(&group_payload(&g)),
                Err(ProtocolError::Malformed(_))
            ));
        };
        let mut g = sample_grant();
        g.vault_key = "zz".repeat(32);
        reject(g);
        let mut g = sample_grant();
        g.vault_key = "ab".repeat(31);
        reject(g);
        let mut g = sample_grant();
        g.secrets[1].secret = "ab".repeat(33);
        reject(g);
        let mut g = sample_grant();
        g.secrets.clear();
        reject(g);
        let mut g = sample_grant();
        g.secrets = (0..=MAX_EPOCHS as u32)
            .map(|epoch| EpochSecret {
                epoch,
                secret: "ab".repeat(32),
            })
            .collect();
        reject(g);
        let mut g = sample_grant();
        g.group_id = "g".repeat(MAX_GROUP_ID_LEN + 1);
        reject(g);
        let mut g = sample_grant();
        g.host_name = "h".repeat(MAX_HOST_NAME_LEN + 1);
        reject(g);
        let mut g = sample_grant();
        g.secrets = (0..MAX_EPOCHS as u32)
            .map(|epoch| EpochSecret {
                epoch,
                secret: "ab".repeat(32),
            })
            .collect();
        assert!(decode(&group_payload(&g)).is_ok());
    }

    #[test]
    fn part1_decoder_view() {
        let kind_of = |f: Frame| encode(&f).unwrap()[4];
        assert_eq!(kind_of(Frame::Pair(Pair::Cancel)), 9);
        assert_eq!(kind_of(Frame::Group(sample_grant())), 10);
        assert_eq!(
            kind_of(Frame::Presence(Presence {
                state: PresenceState::Live
            })),
            11
        );
        for kind in [9, 10, 11] {
            assert!(!(6..=8).contains(&kind) && kind != 12);
        }
        assert_eq!(decode(&[13]).unwrap(), Frame::Unknown(13));
    }

    #[tokio::test]
    async fn rejects_oversized_length() {
        let mut r: &[u8] = &[0xFF, 0xFF, 0xFF, 0xFF, 1, 2];
        assert!(matches!(
            read_frame(&mut r).await,
            Err(ProtocolError::TooLarge(_))
        ));
    }

    #[test]
    fn unknown_kind_decodes_to_unknown() {
        assert_eq!(decode(&[13]).unwrap(), Frame::Unknown(13));
        assert_eq!(decode(&[0, 1, 2, 3]).unwrap(), Frame::Unknown(0));
        assert!(matches!(
            encode(&Frame::Unknown(13)),
            Err(ProtocolError::UnknownKind(13))
        ));
    }

    #[test]
    fn addrs_frame_roundtrips_and_old_decoders_see_unknown() {
        let f = Frame::Addrs(Addrs {
            addrs: vec!["10.7.7.7:47391".into()],
        });
        assert_eq!(decode(&encode(&f).unwrap()[4..]).unwrap(), f);
        assert!(matches!(
            decode(&[12, b'{', b'}']),
            Err(ProtocolError::Malformed(_))
        ));
        assert_eq!(
            decode(&[&[12][..], br#"{"addrs":["10.7.7.7:47391"]}"#].concat()).unwrap(),
            f
        );
        let huge = [&[12][..], &vec![b' '; 4097]].concat();
        assert!(matches!(decode(&huge), Err(ProtocolError::Malformed(_))));
    }

    #[test]
    fn rejects_empty_and_bad_payloads() {
        assert!(matches!(decode(&[]), Err(ProtocolError::Malformed(_))));
        for kind in [KIND_HELLO, KIND_AUTH] {
            assert!(matches!(
                decode(&[kind, b'x']),
                Err(ProtocolError::Malformed(_))
            ));
        }
        assert!(matches!(decode(&[3, 0]), Err(ProtocolError::Malformed(_))));
    }

    #[tokio::test]
    async fn truncated_frame_is_io_error() {
        let mut r: &[u8] = &[0, 0, 0, 10, 1, 2, 3, 4];
        assert!(matches!(
            read_frame(&mut r).await,
            Err(ProtocolError::Io(_))
        ));
    }

    #[tokio::test]
    async fn write_then_read_roundtrip() {
        let f = Frame::Blob(vec![5; 100]);
        let mut buf = Vec::new();
        write_frame(&mut buf, &encode(&f).unwrap()).await.unwrap();
        let mut r: &[u8] = &buf;
        assert_eq!(decode(&read_frame(&mut r).await.unwrap()).unwrap(), f);
    }

    proptest! {
        #[test]
        fn decode_never_panics(bytes in proptest::collection::vec(any::<u8>(), 0..4096)) {
            let _ = decode(&bytes);
        }
    }
}
