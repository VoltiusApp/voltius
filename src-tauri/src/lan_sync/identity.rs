use base64::{engine::general_purpose::STANDARD, Engine};
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
        let secret = x25519_dalek::StaticSecret::from(private);
        let public = *x25519_dalek::PublicKey::from(&secret).as_bytes();
        Self { private, public }
    }

    pub fn generate() -> Self {
        let mut private = [0u8; 32];
        rand::Rng::fill(&mut rand::rngs::OsRng, &mut private);
        Self::from_private(private)
    }
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
        let expected = x25519_dalek::PublicKey::from(&x25519_dalek::StaticSecret::from(k.private));
        assert_eq!(k.public, *expected.as_bytes());
        assert_ne!(k.private, DeviceKey::generate().private);
    }
}
