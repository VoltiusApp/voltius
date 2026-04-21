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

/// key_type:   "ed25519" | "ecdsa" | "rsa" | "dsa"
/// curve:      "256" | "384" | "521"           (ecdsa only)
/// bits:       1024 | 2048 | 4096              (rsa only)
/// passphrase: empty string = no encryption
/// cipher:     "aes256-ctr" | "aes256-gcm" | "aes128-ctr" | "3des-cbc"
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

            "dsa" => {
                let key =
                    PrivateKey::random(&mut rng, Algorithm::Dsa).map_err(|e| e.to_string())?;
                (key, "DSA".to_string())
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
