// Only the Android and Windows backends seal; elsewhere the stub never builds an outcome.
#![cfg_attr(
    not(any(target_os = "android", target_os = "windows")),
    allow(dead_code)
)]

use serde::Serialize;

#[cfg_attr(not(target_os = "android"), allow(dead_code))]
pub const ANDROID: u8 = 1;
#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
pub const WINDOWS: u8 = 2;
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

#[cfg(any(windows, test))]
mod hello_crypto {
    use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM, NONCE_LEN};
    use ring::rand::{SecureRandom, SystemRandom};
    use zeroize::Zeroizing;

    const INFO: &[u8] = b"voltius-vault-seal-v1";
    const SALT_LEN: usize = 32;

    fn key(signature: &[u8], salt: &[u8; SALT_LEN]) -> Option<LessSafeKey> {
        let mut kek = Zeroizing::new([0u8; 32]);
        hkdf::Hkdf::<sha2::Sha256>::new(Some(salt), signature)
            .expand(INFO, kek.as_mut())
            .ok()?;
        Some(LessSafeKey::new(
            UnboundKey::new(&AES_256_GCM, kek.as_ref()).ok()?,
        ))
    }

    pub fn salt_of(body: &[u8]) -> Option<[u8; SALT_LEN]> {
        body.get(..SALT_LEN)?.try_into().ok()
    }

    pub fn seal_with_signature(
        signature: &[u8],
        salt: &[u8; SALT_LEN],
        plaintext: &[u8],
    ) -> Option<Vec<u8>> {
        let mut nonce = [0u8; NONCE_LEN];
        SystemRandom::new().fill(&mut nonce).ok()?;
        let mut ct = plaintext.to_vec();
        key(signature, salt)?
            .seal_in_place_append_tag(Nonce::assume_unique_for_key(nonce), Aad::empty(), &mut ct)
            .ok()?;
        Some([salt.as_slice(), &nonce, &ct].concat())
    }

    pub fn open_with_signature(signature: &[u8], body: &[u8]) -> Option<Vec<u8>> {
        let salt = salt_of(body)?;
        let nonce: [u8; NONCE_LEN] = body.get(SALT_LEN..SALT_LEN + NONCE_LEN)?.try_into().ok()?;
        let mut ct = Zeroizing::new(body.get(SALT_LEN + NONCE_LEN..)?.to_vec());
        let pt = key(signature, &salt)?
            .open_in_place(Nonce::assume_unique_for_key(nonce), Aad::empty(), &mut ct)
            .ok()?;
        Some(pt.to_vec())
    }
}

#[cfg(any(windows, test))]
pub use hello_crypto::{open_with_signature, salt_of, seal_with_signature};

pub struct PlatformSealer;

#[cfg(not(target_os = "windows"))]
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
        let blob = frame(WINDOWS, b"body");
        assert_eq!(&blob[..4], b"VS1\x02");
        assert_eq!(unframe(WINDOWS, &blob), Some(&b"body"[..]));
        assert_eq!(unframe(ANDROID, &blob), None);
        assert_eq!(unframe(WINDOWS, b"VS1"), None);
        assert_eq!(unframe(WINDOWS, b"XX1\x02body"), None);
    }

    #[test]
    fn a_signature_seals_and_opens() {
        let sig = [5u8; 256];
        let body = seal_with_signature(&sig, &[1u8; 32], b"hunter2").unwrap();
        assert_eq!(salt_of(&body), Some([1u8; 32]));
        assert_eq!(open_with_signature(&sig, &body).unwrap(), b"hunter2");
    }

    #[test]
    fn another_signature_does_not_open() {
        let body = seal_with_signature(&[5u8; 256], &[1u8; 32], b"hunter2").unwrap();
        assert_eq!(open_with_signature(&[6u8; 256], &body), None);
    }

    #[test]
    fn a_truncated_body_does_not_open() {
        let sig = [5u8; 256];
        let body = seal_with_signature(&sig, &[1u8; 32], b"hunter2").unwrap();
        assert_eq!(open_with_signature(&sig, &body[..40]), None);
        assert_eq!(salt_of(&body[..10]), None);
    }

    #[test]
    fn outcomes_serialise_as_kebab_strings() {
        assert_eq!(
            serde_json::to_string(&SealStatus::from(&SealOutcome::Invalidated)).unwrap(),
            "\"invalidated\""
        );
    }
}
