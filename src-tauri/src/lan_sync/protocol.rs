use serde::{Deserialize, Serialize};
use tokio::io::{AsyncWrite, AsyncWriteExt};

pub const PROTOCOL_VERSION: u16 = 1;
pub const MAX_FRAME: usize = 16 * 1024 * 1024;

const KIND_HELLO: u8 = 1;
const KIND_BLOB: u8 = 2;
const KIND_NUDGE: u8 = 3;
const KIND_BYE: u8 = 4;
const KIND_AUTH: u8 = 5;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Hello {
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub device_key: [u8; 32],
    pub device_sig: Vec<u8>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Auth {
    pub version: u16,
    pub proofs: Vec<[u8; 32]>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Frame {
    Hello(Hello),
    Auth(Auth),
    Blob(Vec<u8>),
    Nudge,
    Bye,
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

pub fn encode(frame: &Frame) -> Result<Vec<u8>, ProtocolError> {
    let (kind, payload) = match frame {
        Frame::Hello(h) => (KIND_HELLO, to_json(h)?),
        Frame::Auth(a) => (KIND_AUTH, to_json(a)?),
        Frame::Blob(b) => (KIND_BLOB, b.clone()),
        Frame::Nudge => (KIND_NUDGE, Vec::new()),
        Frame::Bye => (KIND_BYE, Vec::new()),
        Frame::Unknown(kind) => return Err(ProtocolError::UnknownKind(*kind)),
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
        KIND_BLOB => Ok(Frame::Blob(payload.to_vec())),
        KIND_NUDGE | KIND_BYE if !payload.is_empty() => {
            Err(ProtocolError::Malformed("unexpected payload".into()))
        }
        KIND_NUDGE => Ok(Frame::Nudge),
        KIND_BYE => Ok(Frame::Bye),
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
        }
    }

    #[test]
    fn roundtrip_every_kind() {
        for f in [
            Frame::Hello(sample_hello()),
            Frame::Auth(Auth {
                version: PROTOCOL_VERSION,
                proofs: vec![[7u8; 32], [9u8; 32]],
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
        assert_eq!(decode(&[9]).unwrap(), Frame::Unknown(9));
        assert_eq!(decode(&[0, 1, 2, 3]).unwrap(), Frame::Unknown(0));
        assert!(matches!(
            encode(&Frame::Unknown(9)),
            Err(ProtocolError::UnknownKind(9))
        ));
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
