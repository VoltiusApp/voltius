use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::{Zeroize, Zeroizing};

const DEVICE_KEY_ENTRY: &str = "lan_sync_device_key";
const AUTH_INFO: &[u8] = b"voltius-lan-sync-auth-v1";

pub struct DeviceKey {
    pub private: [u8; 32],
    pub public: [u8; 32],
}

pub struct LocalIdentity {
    pub device_id: String,
    pub device_name: String,
    pub platform: String,
    pub key: DeviceKey,
}

pub fn derive_auth_key(key: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    Hkdf::<Sha256>::new(None, key)
        .expand(AUTH_INFO, &mut out)
        .expect("32 bytes is a valid HKDF-SHA256 output length");
    out
}

impl DeviceKey {
    pub fn from_private(private: [u8; 32]) -> Self {
        let public = SigningKey::from_bytes(&private).verifying_key().to_bytes();
        Self { private, public }
    }

    pub fn generate() -> Self {
        let mut private = [0u8; 32];
        rand::Rng::fill(&mut rand::rngs::OsRng, &mut private);
        Self::from_private(private)
    }

    pub fn sign(&self, msg: &[u8]) -> [u8; 64] {
        SigningKey::from_bytes(&self.private).sign(msg).to_bytes()
    }
}

pub fn verify_signature(public: &[u8; 32], msg: &[u8], sig: &[u8]) -> bool {
    let (Ok(key), Ok(sig)) = (VerifyingKey::from_bytes(public), Signature::from_slice(sig)) else {
        return false;
    };
    key.verify_strict(msg, &sig).is_ok()
}

impl Drop for DeviceKey {
    fn drop(&mut self) {
        self.private.zeroize();
    }
}

pub fn load_or_create_device_key() -> Result<DeviceKey, String> {
    use crate::commands::keychain::{entry, read};
    let corrupt = |why: String| format!("corrupt {DEVICE_KEY_ENTRY}: {why}");
    if let Some(stored) = read(DEVICE_KEY_ENTRY).map_err(|e| e.to_string())? {
        let stored = Zeroizing::new(stored);
        let bytes = Zeroizing::new(
            STANDARD
                .decode(stored.as_bytes())
                .map_err(|e| corrupt(e.to_string()))?,
        );
        let private = bytes
            .as_slice()
            .try_into()
            .map_err(|_| corrupt("bad length".into()))?;
        return Ok(DeviceKey::from_private(private));
    }
    let key = DeviceKey::generate();
    let encoded = Zeroizing::new(STANDARD.encode(key.private));
    entry(DEVICE_KEY_ENTRY)
        .and_then(|e| e.set_password(&encoded))
        .map_err(|e| e.to_string())?;
    Ok(key)
}

#[cfg(test)]
pub(crate) fn test_identity(id: &str) -> LocalIdentity {
    LocalIdentity {
        device_id: id.into(),
        device_name: format!("{id} name"),
        platform: "linux".into(),
        key: DeviceKey::from_private(derive_auth_key(id.as_bytes())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_key_is_deterministic_and_not_the_input() {
        let k = [7u8; 32];
        assert_eq!(derive_auth_key(&k), derive_auth_key(&k));
        assert_ne!(derive_auth_key(&k), k);
        assert_ne!(derive_auth_key(&k), derive_auth_key(&[8u8; 32]));
    }

    #[test]
    fn generated_public_matches_private() {
        let k = DeviceKey::generate();
        let expected = ed25519_dalek::SigningKey::from_bytes(&k.private).verifying_key();
        assert_eq!(k.public, expected.to_bytes());
        assert_ne!(k.private, DeviceKey::generate().private);
    }

    #[test]
    fn sign_verifies_with_public() {
        let k = DeviceKey::generate();
        let sig = k.sign(b"hello");
        assert!(verify_signature(&k.public, b"hello", &sig));
        assert!(!verify_signature(&k.public, b"hellO", &sig));
        assert!(!verify_signature(
            &DeviceKey::generate().public,
            b"hello",
            &sig
        ));
        assert!(!verify_signature(&k.public, b"hello", &sig[..63]));
    }
}
