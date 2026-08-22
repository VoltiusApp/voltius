use rand::RngCore;
use serde::Serialize;
use ssh_key::{Algorithm, Cipher, EcdsaCurve, Kdf, LineEnding, PrivateKey};
use tokio::task::spawn_blocking;

#[derive(Serialize)]
pub struct GeneratedKeyPair {
    pub private_key: String,
    pub public_key: String,
    pub key_type_label: String,
}

/// The public half is missing whenever a key was imported private-only, so the
/// callers need to tell "give me the passphrase" apart from "that is not a key".
/// Codes, not prose: the UI branches on them and translates its own message.
pub const ERR_ENCRYPTED: &str = "ENCRYPTED";
pub const ERR_INVALID: &str = "INVALID";

fn derive_public_key(private_key: &str, passphrase: Option<&str>) -> Result<String, String> {
    let key = PrivateKey::from_openssh(private_key.trim()).map_err(|_| ERR_INVALID.to_string())?;
    let key = if key.is_encrypted() {
        let passphrase = passphrase
            .filter(|p| !p.is_empty())
            .ok_or_else(|| ERR_ENCRYPTED.to_string())?;
        key.decrypt(passphrase)
            .map_err(|_| ERR_ENCRYPTED.to_string())?
    } else {
        key
    };
    key.public_key()
        .to_openssh()
        .map_err(|_| ERR_INVALID.to_string())
}

#[tauri::command]
pub async fn ssh_public_key_from_private(
    private_key: String,
    passphrase: Option<String>,
) -> Result<String, String> {
    spawn_blocking(move || derive_public_key(&private_key, passphrase.as_deref()))
        .await
        .map_err(|e| e.to_string())?
}

/// key_type:   "ed25519" | "ecdsa" | "rsa"
/// curve:      "256" | "384" | "521"     (ecdsa only)
/// bits:       2048 | 4096               (rsa only)
/// passphrase: empty string = no encryption
/// cipher:     "aes256-ctr" | "aes256-gcm"
/// rounds:     bcrypt-pbkdf iterations (default 16)
#[tauri::command]
pub async fn generate_ssh_keypair(
    key_type: String,
    curve: Option<String>,
    bits: Option<u32>,
    passphrase: Option<String>,
    cipher: Option<String>,
    rounds: Option<u32>,
) -> Result<GeneratedKeyPair, String> {
    spawn_blocking(move || {
        let mut rng = rand::thread_rng();

        let (private_key, key_type_label) = match key_type.as_str() {
            "ed25519" => {
                let key =
                    PrivateKey::random(&mut rng, Algorithm::Ed25519).map_err(|e| e.to_string())?;
                (key, "ED25519".to_string())
            }

            "ecdsa" => {
                let ssh_curve = match curve.as_deref().unwrap_or("256") {
                    "256" => EcdsaCurve::NistP256,
                    "384" => EcdsaCurve::NistP384,
                    "521" => EcdsaCurve::NistP521,
                    other => return Err(format!("Unknown ECDSA curve: {other}")),
                };
                let label = format!("ECDSA P-{}", curve.as_deref().unwrap_or("256"));
                let key = PrivateKey::random(&mut rng, Algorithm::Ecdsa { curve: ssh_curve })
                    .map_err(|e| e.to_string())?;
                (key, label)
            }

            "rsa" => {
                let key_bits = bits.unwrap_or(4096) as usize;
                let label = format!("RSA {key_bits}");
                let rsa_priv =
                    rsa::RsaPrivateKey::new(&mut rng, key_bits).map_err(|e| e.to_string())?;
                let keypair =
                    ssh_key::private::RsaKeypair::try_from(rsa_priv).map_err(|e| e.to_string())?;
                let key = PrivateKey::new(ssh_key::private::KeypairData::Rsa(keypair), "")
                    .map_err(|e| e.to_string())?;
                (key, label)
            }

            other => return Err(format!("Unsupported key type: {other}")),
        };

        let public_key = private_key
            .public_key()
            .to_openssh()
            .map_err(|e| e.to_string())?;

        let private_pem = match passphrase.as_deref() {
            Some(p) if !p.is_empty() => {
                let ssh_cipher = match cipher.as_deref().unwrap_or("aes256-ctr") {
                    "aes256-gcm" => Cipher::Aes256Gcm,
                    "aes128-ctr" => Cipher::Aes128Ctr,
                    "3des-cbc" => Cipher::TDesCbc,
                    _ => Cipher::Aes256Ctr,
                };
                let kdf_rounds = rounds.unwrap_or(16);
                let mut salt = vec![0u8; 16];
                rng.fill_bytes(&mut salt);
                let kdf = Kdf::Bcrypt {
                    salt,
                    rounds: kdf_rounds,
                };
                let checkint: u32 = rng.next_u32();
                private_key
                    .encrypt_with(ssh_cipher, kdf, checkint, p)
                    .map_err(|e| e.to_string())?
                    .to_openssh(LineEnding::LF)
                    .map_err(|e| e.to_string())?
            }
            _ => private_key
                .to_openssh(LineEnding::LF)
                .map_err(|e| e.to_string())?,
        };

        Ok(GeneratedKeyPair {
            private_key: private_pem.to_string(),
            public_key,
            key_type_label,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ed25519_pem(passphrase: Option<&str>) -> (String, String) {
        let mut rng = rand::thread_rng();
        let key = PrivateKey::random(&mut rng, Algorithm::Ed25519).unwrap();
        let public = key.public_key().to_openssh().unwrap();
        let pem = match passphrase {
            Some(p) => key
                .encrypt(&mut rng, p)
                .unwrap()
                .to_openssh(LineEnding::LF)
                .unwrap(),
            None => key.to_openssh(LineEnding::LF).unwrap(),
        };
        (pem.to_string(), public)
    }

    #[test]
    fn derives_the_public_half_of_a_plaintext_key() {
        let (pem, public) = ed25519_pem(None);
        assert_eq!(derive_public_key(&pem, None).unwrap(), public);
    }

    #[test]
    fn derives_the_public_half_of_an_encrypted_key() {
        let (pem, public) = ed25519_pem(Some("hunter2"));
        assert_eq!(derive_public_key(&pem, Some("hunter2")).unwrap(), public);
    }

    #[test]
    fn reports_encrypted_when_the_passphrase_is_missing_or_wrong() {
        let (pem, _) = ed25519_pem(Some("hunter2"));
        assert_eq!(
            derive_public_key(&pem, None),
            Err(ERR_ENCRYPTED.to_string())
        );
        assert_eq!(
            derive_public_key(&pem, Some("")),
            Err(ERR_ENCRYPTED.to_string())
        );
        assert_eq!(
            derive_public_key(&pem, Some("wrong")),
            Err(ERR_ENCRYPTED.to_string())
        );
    }

    #[test]
    fn reports_invalid_for_anything_that_is_not_a_private_key() {
        assert_eq!(
            derive_public_key("nonsense", None),
            Err(ERR_INVALID.to_string())
        );
        let (_, public) = ed25519_pem(None);
        assert_eq!(
            derive_public_key(&public, None),
            Err(ERR_INVALID.to_string())
        );
    }
}
