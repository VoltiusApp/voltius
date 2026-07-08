//! PBES2 encryption.

use super::{EncryptionScheme, Kdf, Parameters, Pbkdf2Params, Pbkdf2Prf, ScryptParams};
use crate::{Error, Result};
use cbc::cipher::{
    BlockCipherDecrypt, BlockCipherEncrypt, BlockModeDecrypt, BlockModeEncrypt, KeyInit, KeyIvInit,
    block_padding::Pkcs7,
};
use pbkdf2::{
    hmac::{
        EagerHash,
        digest::{
            FixedOutput, HashMarker, Update,
            block_api::BlockSizeUser,
            typenum::{IsLess, NonZero, True, U256},
        },
    },
    pbkdf2_hmac,
};
use scrypt::scrypt;

/// Maximum size of a derived encryption key
const MAX_KEY_LEN: usize = 32;

fn cbc_encrypt<'a, C: BlockCipherEncrypt + KeyInit>(
    es: EncryptionScheme,
    key: EncryptionKey,
    iv: &[u8],
    buffer: &'a mut [u8],
    pos: usize,
) -> Result<&'a [u8]> {
    cbc::Encryptor::<C>::new_from_slices(key.as_slice(), iv)
        .map_err(|_| es.to_alg_params_invalid())?
        .encrypt_padded::<Pkcs7>(buffer, pos)
        .map_err(|_| Error::EncryptFailed)
}

fn cbc_decrypt<'a, C: BlockCipherDecrypt + KeyInit>(
    es: EncryptionScheme,
    key: EncryptionKey,
    iv: &[u8],
    buffer: &'a mut [u8],
) -> Result<&'a [u8]> {
    cbc::Decryptor::<C>::new_from_slices(key.as_slice(), iv)
        .map_err(|_| es.to_alg_params_invalid())?
        .decrypt_padded::<Pkcs7>(buffer)
        .map_err(|_| Error::DecryptFailed)
}

pub fn encrypt_in_place<'b>(
    params: &Parameters,
    password: impl AsRef<[u8]>,
    buf: &'b mut [u8],
    pos: usize,
) -> Result<&'b [u8]> {
    let es = params.encryption;
    let key_size = es.key_size();
    if key_size > MAX_KEY_LEN {
        return Err(es.to_alg_params_invalid());
    }
    let key = EncryptionKey::derive_from_password(password.as_ref(), &params.kdf, key_size)?;

    match es {
        EncryptionScheme::Aes128Cbc { iv } => cbc_encrypt::<aes::Aes128Enc>(es, key, &iv, buf, pos),
        EncryptionScheme::Aes192Cbc { iv } => cbc_encrypt::<aes::Aes192Enc>(es, key, &iv, buf, pos),
        EncryptionScheme::Aes256Cbc { iv } => cbc_encrypt::<aes::Aes256Enc>(es, key, &iv, buf, pos),
        #[cfg(feature = "3des")]
        EncryptionScheme::DesEde3Cbc { iv } => cbc_encrypt::<des::TdesEde3>(es, key, &iv, buf, pos),
        #[cfg(feature = "des-insecure")]
        EncryptionScheme::DesCbc { .. } => Err(Error::UnsupportedAlgorithm {
            oid: super::DES_CBC_OID,
        }),
    }
}

/// Decrypt a message encrypted with PBES2-based key derivation
pub fn decrypt_in_place<'a>(
    params: &Parameters,
    password: impl AsRef<[u8]>,
    buf: &'a mut [u8],
) -> Result<&'a [u8]> {
    let es = params.encryption;
    let key = EncryptionKey::derive_from_password(password.as_ref(), &params.kdf, es.key_size())?;

    match es {
        EncryptionScheme::Aes128Cbc { iv } => cbc_decrypt::<aes::Aes128Dec>(es, key, &iv, buf),
        EncryptionScheme::Aes192Cbc { iv } => cbc_decrypt::<aes::Aes192Dec>(es, key, &iv, buf),
        EncryptionScheme::Aes256Cbc { iv } => cbc_decrypt::<aes::Aes256Dec>(es, key, &iv, buf),
        #[cfg(feature = "3des")]
        EncryptionScheme::DesEde3Cbc { iv } => cbc_decrypt::<des::TdesEde3>(es, key, &iv, buf),
        #[cfg(feature = "des-insecure")]
        EncryptionScheme::DesCbc { iv } => cbc_decrypt::<des::Des>(es, key, &iv, buf),
    }
}

/// Encryption key as derived by PBKDF2
// TODO(tarcieri): zeroize?
struct EncryptionKey {
    buffer: [u8; MAX_KEY_LEN],
    length: usize,
}

impl EncryptionKey {
    /// Derive an encryption key using the supplied PBKDF parameters.
    pub fn derive_from_password(password: &[u8], kdf: &Kdf, key_size: usize) -> Result<Self> {
        // if the kdf params defined a key length, ensure it matches the required key size
        if let Some(len) = kdf.key_length() {
            if key_size != usize::from(len) {
                return Err(kdf.to_alg_params_invalid());
            }
        }

        match kdf {
            Kdf::Pbkdf2(pbkdf2_params) => {
                let key = match pbkdf2_params.prf {
                    #[cfg(feature = "sha1-insecure")]
                    Pbkdf2Prf::HmacWithSha1 => EncryptionKey::derive_with_pbkdf2::<sha1::Sha1>(
                        password,
                        pbkdf2_params,
                        key_size,
                    ),
                    #[cfg(not(feature = "sha1-insecure"))]
                    Pbkdf2Prf::HmacWithSha1 => {
                        return Err(Error::UnsupportedAlgorithm {
                            oid: super::HMAC_WITH_SHA1_OID,
                        });
                    }
                    Pbkdf2Prf::HmacWithSha224 => EncryptionKey::derive_with_pbkdf2::<sha2::Sha224>(
                        password,
                        pbkdf2_params,
                        key_size,
                    ),
                    Pbkdf2Prf::HmacWithSha256 => EncryptionKey::derive_with_pbkdf2::<sha2::Sha256>(
                        password,
                        pbkdf2_params,
                        key_size,
                    ),
                    Pbkdf2Prf::HmacWithSha384 => EncryptionKey::derive_with_pbkdf2::<sha2::Sha384>(
                        password,
                        pbkdf2_params,
                        key_size,
                    ),
                    Pbkdf2Prf::HmacWithSha512 => EncryptionKey::derive_with_pbkdf2::<sha2::Sha512>(
                        password,
                        pbkdf2_params,
                        key_size,
                    ),
                };

                Ok(key)
            }
            Kdf::Scrypt(scrypt_params) => {
                EncryptionKey::derive_with_scrypt(password, scrypt_params, key_size)
            }
        }
    }

    /// Derive key using PBKDF2.
    fn derive_with_pbkdf2<D>(password: &[u8], params: &Pbkdf2Params, length: usize) -> Self
    where
        D: EagerHash + HashMarker + Update + FixedOutput + Default + Clone,
        <D as EagerHash>::Core: Sync,
        <D as BlockSizeUser>::BlockSize: IsLess<U256, Output = True> + NonZero,
    {
        let mut buffer = [0u8; MAX_KEY_LEN];

        pbkdf2_hmac::<D>(
            password,
            params.salt.as_ref(),
            params.iteration_count,
            &mut buffer[..length],
        );

        Self { buffer, length }
    }

    /// Derive key using scrypt.
    fn derive_with_scrypt(password: &[u8], params: &ScryptParams, length: usize) -> Result<Self> {
        let mut buffer = [0u8; MAX_KEY_LEN];
        scrypt(
            password,
            params.salt.as_ref(),
            &params.try_into()?,
            &mut buffer[..length],
        )
        .map_err(|_| Error::AlgorithmParametersInvalid {
            oid: super::SCRYPT_OID,
        })?;

        Ok(Self { buffer, length })
    }

    /// Get the key material as a slice
    fn as_slice(&self) -> &[u8] {
        &self.buffer[..self.length]
    }
}
