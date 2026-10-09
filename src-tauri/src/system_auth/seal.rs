// Only the Android backend seals; elsewhere the stub never builds an outcome.
#![cfg_attr(not(target_os = "android"), allow(dead_code))]

use serde::Serialize;

pub const ANDROID: u8 = 1;
const MAGIC: &[u8; 3] = b"VS1";

#[derive(Debug, PartialEq, Eq)]
pub enum SealOutcome {
    Ok(Vec<u8>),
    Cancelled,
    Failed,
    Invalidated,
    Unavailable,
}

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SealStatus {
    Ok,
    None,
    Cancelled,
    Failed,
    Invalidated,
    Unavailable,
}

impl From<&SealOutcome> for SealStatus {
    fn from(o: &SealOutcome) -> Self {
        match o {
            SealOutcome::Ok(_) => SealStatus::Ok,
            SealOutcome::Cancelled => SealStatus::Cancelled,
            SealOutcome::Failed => SealStatus::Failed,
            SealOutcome::Invalidated => SealStatus::Invalidated,
            SealOutcome::Unavailable => SealStatus::Unavailable,
        }
    }
}

pub fn frame(platform: u8, body: &[u8]) -> Vec<u8> {
    [MAGIC.as_slice(), &[platform], body].concat()
}

pub fn unframe(platform: u8, blob: &[u8]) -> Option<&[u8]> {
    match blob {
        [a, b, c, p, body @ ..] if [*a, *b, *c] == *MAGIC && *p == platform => Some(body),
        _ => None,
    }
}

#[allow(async_fn_in_trait)]
pub trait Sealer {
    fn available(&self) -> bool;
    async fn seal(&self, reason: &str, plaintext: &[u8]) -> SealOutcome;
    async fn unseal(&self, reason: &str, blob: &[u8]) -> SealOutcome;
}

pub struct PlatformSealer;

#[cfg(not(target_os = "android"))]
impl Sealer for PlatformSealer {
    fn available(&self) -> bool {
        false
    }
    async fn seal(&self, _reason: &str, _plaintext: &[u8]) -> SealOutcome {
        SealOutcome::Unavailable
    }
    async fn unseal(&self, _reason: &str, _blob: &[u8]) -> SealOutcome {
        SealOutcome::Unavailable
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn framing_round_trips_and_rejects_other_platforms() {
        let blob = frame(ANDROID, b"body");
        assert_eq!(&blob[..4], b"VS1\x01");
        assert_eq!(unframe(ANDROID, &blob), Some(&b"body"[..]));
        assert_eq!(unframe(2, &blob), None);
        assert_eq!(unframe(ANDROID, b"VS1"), None);
        assert_eq!(unframe(ANDROID, b"XX1\x01body"), None);
    }

    #[test]
    fn outcomes_serialise_as_kebab_strings() {
        assert_eq!(
            serde_json::to_string(&SealStatus::from(&SealOutcome::Invalidated)).unwrap(),
            "\"invalidated\""
        );
    }
}
