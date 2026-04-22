use argon2::{Algorithm, Argon2, Params, Version};
use hkdf::Hkdf;
use sha2::Sha256;

fn derive_master_key(password: &str, account_id: &str) -> Result<[u8; 32], String> {
    let params = Params::new(32 * 1024, 2, 1, Some(32)).map_err(|e| e.to_string())?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut master_key = [0u8; 32];
    argon2
        .hash_password_into(password.as_bytes(), account_id.as_bytes(), &mut master_key)
        .map_err(|e| format!("Argon2id failed: {e}"))?;
    Ok(master_key)
}

fn hkdf_expand(master_key: &[u8; 32], info: &[u8]) -> Result<[u8; 32], String> {
    let hkdf = Hkdf::<Sha256>::new(None, master_key);
    let mut out = [0u8; 32];
    hkdf.expand(info, &mut out)
        .map_err(|e| format!("HKDF expand failed: {e}"))?;
    Ok(out)
}

pub fn derive_keys(password: &str, account_id: &str) -> Result<DerivedKeys, String> {
    let master_key = derive_master_key(password, account_id)?;
    let auth_key = hkdf_expand(&master_key, b"auth")?;
    let enc_key = hkdf_expand(&master_key, b"enc")?;
    Ok(DerivedKeys { auth_key, enc_key })
}

pub struct DerivedKeys {
    pub auth_key: [u8; 32],
    pub enc_key: [u8; 32],
}

pub fn generate_keypair() -> Keypair {
    use rand::rngs::OsRng;
    use x25519_dalek::{PublicKey, StaticSecret};

    let secret = StaticSecret::random_from_rng(OsRng);
    let public = PublicKey::from(&secret);

    Keypair {
        public_key: base64::Engine::encode(
            &base64::engine::general_purpose::STANDARD,
            public.as_bytes(),
        ),
        private_key_bytes: secret.to_bytes().to_vec(),
    }
}

pub struct Keypair {
    pub public_key: String,
    #[allow(dead_code)]
    pub private_key_bytes: Vec<u8>,
}
