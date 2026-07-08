// Format documentation:
// https://tartarus.org/~simon/putty-snapshots/htmldoc/AppendixC.html

use alloc::collections::BTreeMap;
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use argon2::Argon2;
use core::fmt::{Debug, Display};
use core::num::ParseIntError;
use core::str::FromStr;
use hex::FromHex;
use hmac::digest::KeyInit;
use hmac::{Hmac, Mac};
use sha1::{Digest, Sha1};
use sha2::Sha256;

use crate::private::KeypairData;
use crate::public::KeyData;
use crate::{Algorithm, Error, PublicKey};
use ctutils::CtEq;
use encoding::base64::{self, Base64, Encoding};
use encoding::{Decode, Encode, LabelError, Reader};

#[derive(Debug)]
pub(crate) enum Kdf {
    Argon2 { kdf: Argon2<'static>, salt: Vec<u8> },
    PpkV2,
}

impl Kdf {
    pub(crate) fn new_v2() -> Self {
        Self::PpkV2
    }

    pub(crate) fn new_v3(algorithm: &str, ppk: &PpkWrapper) -> Result<Self, PpkParseError> {
        let argon_algorithm = match algorithm {
            "Argon2i" => Ok(argon2::Algorithm::Argon2i),
            "Argon2d" => Ok(argon2::Algorithm::Argon2d),
            "Argon2id" => Ok(argon2::Algorithm::Argon2id),
            _ => Err(PpkParseError::UnsupportedKdf(algorithm.into())),
        }?;

        let parse_int = |key: PpkKey| -> Result<u32, PpkParseError> {
            ppk.values
                .get(&key)
                .ok_or(PpkParseError::MissingValue(key))
                .and_then(|v| v.parse().map_err(PpkParseError::InvalidInteger))
        };

        let argon = Argon2::new(
            argon_algorithm,
            argon2::Version::V0x13,
            argon2::Params::new(
                parse_int(PpkKey::Argon2Memory)?,
                parse_int(PpkKey::Argon2Passes)?,
                parse_int(PpkKey::Argon2Parallelism)?,
                None,
            )
            .map_err(PpkParseError::Argon2)?,
        );

        let salt = Vec::from_hex(
            ppk.values
                .get(&PpkKey::Argon2Salt)
                .ok_or(PpkParseError::MissingValue(PpkKey::Argon2Salt))?,
        )
        .map_err(|e| PpkParseError::HexFormat(e.to_string()))?;

        Ok(Self::Argon2 { kdf: argon, salt })
    }

    pub(crate) fn derive(&self, password: &[u8], output: &mut [u8]) -> Result<(), argon2::Error> {
        match self {
            Kdf::Argon2 { kdf, salt } => kdf.hash_password_into(password, salt, output),
            Kdf::PpkV2 => Ok(()),
        }
    }
}

#[derive(Debug)]
pub(crate) enum Cipher {
    Aes256Cbc,
}

type Aes256CbcKey = [u8; 32];
type Aes256CbcIv = [u8; 16];
type HmacKey = Vec<u8>;

const PPK_V2_MAC_PREFIX: &str = "putty-private-key-file-mac-key";

impl Cipher {
    fn derive_aes_params(
        kdf: &Kdf,
        password: &str,
    ) -> Result<(Aes256CbcKey, Aes256CbcIv, HmacKey), Error> {
        match &kdf {
            Kdf::Argon2 { .. } => {
                let mut key_iv_mac = vec![0; 80];
                kdf.derive(password.as_bytes(), &mut key_iv_mac)
                    .map_err(PpkParseError::Argon2)?;
                let key = &key_iv_mac[..32];
                let iv = &key_iv_mac[32..48];
                let mac_key = &key_iv_mac[48..80];
                Ok((
                    #[allow(clippy::unwrap_used)] // const size
                    key.try_into().unwrap(),
                    #[allow(clippy::unwrap_used)] // const size
                    iv.try_into().unwrap(),
                    mac_key.into(),
                ))
            }
            Kdf::PpkV2 => {
                let mut hashes = {
                    let mut hash = Sha1::default();
                    hash.update([0, 0, 0, 0]);
                    hash.update(password.as_bytes());
                    hash.finalize().to_vec()
                };
                hashes.extend_from_slice(&{
                    let mut hash = Sha1::default();
                    hash.update([0, 0, 0, 1]);
                    hash.update(password.as_bytes());
                    hash.finalize()
                });

                #[allow(clippy::unwrap_used)] // known size
                let aes_key = hashes[..32].try_into().unwrap();
                let iv = [0; 16];

                let mac_key = {
                    let mut hash = Sha1::default();
                    hash.update(PPK_V2_MAC_PREFIX.as_bytes());
                    hash.update(password.as_bytes());
                    hash.finalize()
                }
                .to_vec();

                Ok((aes_key, iv, mac_key))
            }
        }
    }

    pub(crate) fn derive_mac_key(&self, kdf: &Kdf, password: &str) -> Result<HmacKey, Error> {
        Ok(Cipher::derive_aes_params(kdf, password)?.2)
    }

    pub(crate) fn decrypt(&self, buf: &mut [u8], kdf: &Kdf, password: &str) -> Result<(), Error> {
        let (key, iv, _) = Cipher::derive_aes_params(kdf, password)?;
        match self {
            Cipher::Aes256Cbc => cipher::Cipher::Aes256Cbc
                .decrypt(&key, &iv, buf, None)
                .map_err(Into::into),
        }
    }
}

#[derive(Debug)]
pub(crate) struct PpkEncryption {
    pub cipher: Cipher,
    pub kdf: Kdf,
    pub passphrase: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum PpkKey {
    Encryption,
    Comment,
    Mac,
    KeyDerivation,
    Argon2Memory,
    Argon2Passes,
    Argon2Parallelism,
    Argon2Salt,
}

impl TryFrom<&str> for PpkKey {
    type Error = ();

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        match value {
            "Encryption" => Ok(PpkKey::Encryption),
            "Comment" => Ok(PpkKey::Comment),
            "Private-MAC" => Ok(PpkKey::Mac),
            "Key-Derivation" => Ok(PpkKey::KeyDerivation),
            "Argon2-Memory" => Ok(PpkKey::Argon2Memory),
            "Argon2-Passes" => Ok(PpkKey::Argon2Passes),
            "Argon2-Parallelism" => Ok(PpkKey::Argon2Parallelism),
            "Argon2-Salt" => Ok(PpkKey::Argon2Salt),
            _ => Err(()),
        }
    }
}

pub(crate) struct PpkWrapper {
    pub version: u8,
    pub algorithm: Algorithm,
    pub public_key: Option<Vec<u8>>,
    pub private_key: Option<Vec<u8>>,
    pub values: BTreeMap<PpkKey, String>,
}

impl Debug for PpkWrapper {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        f.debug_struct("PpkWrapper")
            .field("version", &self.version)
            .field("algorithm", &self.algorithm)
            .field("public_key", &self.public_key)
            .field("values", &self.values)
            .finish_non_exhaustive()
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PpkParseError {
    Algorithm(LabelError),
    Header(String),
    Syntax(String),
    ValueFormat { key: PpkKey, value: String },
    HexFormat(String), // FromHexError does not implement Eq
    InvalidInteger(ParseIntError),
    IncorrectMac,
    UnknownKey(String),
    MissingValue(PpkKey),
    MissingPublicKey,
    MissingPrivateKey,
    Base64(base64::Error),
    Eof,
    UnsupportedFormatVersion(u8),
    UnsupportedEncryption(String),
    UnsupportedKdf(String),
    Argon2(argon2::Error),
    Encrypted,
}

impl Display for PpkParseError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Algorithm(err) => write!(f, "invalid algorithm: {:?}", err),
            Self::Header(header) => write!(f, "invalid header: {:?}", header),
            Self::Syntax(line) => write!(f, "invalid syntax: {:?}", line),
            Self::ValueFormat { key, value } => {
                write!(f, "invalid value format for key {:?}: {:?}", key, value)
            }
            Self::HexFormat(err) => write!(f, "invalid hex format: {}", err),
            Self::InvalidInteger(err) => write!(f, "invalid integer: {}", err),
            Self::IncorrectMac => write!(f, "incorrect MAC"),
            Self::UnknownKey(key) => write!(f, "unknown key: {:?}", key),
            Self::MissingValue(key) => write!(f, "missing value for key: {:?}", key),
            Self::MissingPublicKey => write!(f, "missing public key"),
            Self::MissingPrivateKey => write!(f, "missing private key"),
            Self::Base64(err) => write!(f, "base64 decode: {}", err),
            Self::Eof => write!(f, "unexpected end of file"),
            Self::UnsupportedFormatVersion(version) => {
                write!(f, "unsupported format version: {}", version)
            }
            Self::UnsupportedEncryption(encryption) => {
                write!(f, "unsupported encryption mode: {:?}", encryption)
            }
            Self::UnsupportedKdf(kdf) => write!(f, "unsupported KDF: {:?}", kdf),
            Self::Argon2(err) => write!(f, "Argon2 error: {:?}", err),
            Self::Encrypted => write!(f, "private key is encrypted"),
        }
    }
}

impl From<PpkParseError> for Error {
    fn from(err: PpkParseError) -> Self {
        Error::Ppk(err)
    }
}

const PPK_HEADER_PREFIX: &str = "PuTTY-User-Key-File-";

impl TryFrom<&str> for PpkWrapper {
    type Error = PpkParseError;

    fn try_from(contents: &str) -> Result<Self, Self::Error> {
        let mut lines = contents.lines();
        let header = lines.next().ok_or(PpkParseError::Eof)?;
        let Some(header) = header.strip_prefix(PPK_HEADER_PREFIX) else {
            return Err(PpkParseError::Header(header.into()));
        };

        let (header_version, header_algorithm) = header
            .split_once(": ")
            .ok_or(PpkParseError::Header(header.into()))?;

        let version = header_version
            .parse()
            .map_err(|_| PpkParseError::Header(header.into()))?;
        if version != 3 && version != 2 {
            return Err(PpkParseError::UnsupportedFormatVersion(version));
        }

        let algorithm = Algorithm::from_str(header_algorithm).map_err(PpkParseError::Algorithm)?;
        let mut public_key = None;
        let mut private_key = None;

        let mut values = BTreeMap::new();
        while let Some(line) = lines.next() {
            let (key, value) = line
                .split_once(": ")
                .ok_or(PpkParseError::Syntax(line.into()))?;

            if key.ends_with("-Lines") {
                let n_lines: usize = value.parse().map_err(PpkParseError::InvalidInteger)?;

                let mut content = Vec::new();
                for _ in 0..n_lines {
                    let line = lines.next().ok_or(PpkParseError::Eof)?;
                    content.extend_from_slice(line.as_bytes());
                }

                let decoded = Base64::decode_in_place(&mut content)
                    .map_err(|e| PpkParseError::Base64(e.into()))?;

                match key {
                    "Public-Lines" => public_key = Some(decoded.to_vec()),
                    "Private-Lines" => private_key = Some(decoded.to_vec()),
                    _ => return Err(PpkParseError::UnknownKey(key.into())),
                }
            } else {
                let key =
                    PpkKey::try_from(key).map_err(|_| PpkParseError::UnknownKey(key.into()))?;

                values.insert(key, value.to_string());
            }
        }

        Ok(PpkWrapper {
            version,
            algorithm,
            public_key,
            private_key,
            values,
        })
    }
}

#[derive(Debug)]
pub(crate) struct PpkContainer {
    pub public_key: PublicKey,
    pub keypair_data: KeypairData,
}

impl PpkContainer {
    pub(crate) fn new(mut ppk: PpkWrapper, passphrase: Option<String>) -> Result<Self, Error> {
        let encryption = match ppk.values.get(&PpkKey::Encryption).map(String::as_str) {
            None | Some("none") => None,
            Some("aes256-cbc") => {
                let Some(passphrase) = passphrase else {
                    return Err(PpkParseError::Encrypted.into());
                };
                match ppk.version {
                    2 => Some(PpkEncryption {
                        kdf: Kdf::new_v2(),
                        cipher: Cipher::Aes256Cbc,
                        passphrase,
                    }),
                    3 => match ppk.values.get(&PpkKey::KeyDerivation).map(String::as_str) {
                        None => {
                            return Err(PpkParseError::MissingValue(PpkKey::KeyDerivation).into());
                        }
                        Some(kdf) => Some(PpkEncryption {
                            kdf: Kdf::new_v3(kdf, &ppk)?,
                            cipher: Cipher::Aes256Cbc,
                            passphrase,
                        }),
                    },
                    v => return Err(PpkParseError::UnsupportedFormatVersion(v).into()),
                }
            }
            Some(v) => return Err(PpkParseError::UnsupportedEncryption(v.into()).into()),
        };

        let mac = Vec::from_hex(
            ppk.values
                .get(&PpkKey::Mac)
                .ok_or(PpkParseError::MissingValue(PpkKey::Mac))?,
        )
        .map_err(|e| PpkParseError::HexFormat(e.to_string()))?;

        let comment = ppk.values.remove(&PpkKey::Comment);
        let public_key = ppk.public_key.ok_or(PpkParseError::MissingPublicKey)?;
        let mut private_key = ppk.private_key.ok_or(PpkParseError::MissingPrivateKey)?;

        if let Some(enc) = &encryption {
            enc.cipher
                .decrypt(&mut private_key, &enc.kdf, &enc.passphrase)?;
        }

        let mac_buffer = {
            let mut buf = vec![];
            ppk.algorithm.encode(&mut buf)?;
            ppk.values
                .get(&PpkKey::Encryption)
                .map(String::as_bytes)
                .unwrap_or_default()
                .encode(&mut buf)?;
            comment
                .as_ref()
                .map(String::as_bytes)
                .unwrap_or_default()
                .encode(&mut buf)?;
            public_key.encode(&mut buf)?;
            private_key.encode(&mut buf)?;
            buf
        };

        let hmac_key = match &encryption {
            None => match ppk.version {
                2 => {
                    let mut hash = Sha1::new();
                    hash.update(PPK_V2_MAC_PREFIX.as_bytes());
                    hash.finalize().to_vec()
                }
                3 => HmacKey::default(),
                _ => unreachable!(),
            },
            Some(enc) => enc.cipher.derive_mac_key(&enc.kdf, &enc.passphrase)?,
        };

        let expected_mac = {
            #[allow(clippy::unwrap_used)] // const key length
            match ppk.version {
                3 => {
                    let mut hmac = Hmac::<Sha256>::new_from_slice(&hmac_key).unwrap();
                    hmac.update(&mac_buffer);
                    hmac.finalize().into_bytes().to_vec()
                }
                2 => {
                    let mut hmac = Hmac::<Sha1>::new_from_slice(&hmac_key).unwrap();
                    hmac.update(&mac_buffer);
                    hmac.finalize().into_bytes().to_vec()
                }
                _ => unreachable!(),
            }
        };

        if expected_mac.ct_ne(&mac).into() {
            return Err(Error::Ppk(PpkParseError::IncorrectMac));
        }

        let mut public_key = PublicKey::from_bytes(&public_key)?;
        let mut private_key_cursor = &private_key[..];
        let keypair_data =
            decode_private_key_as(&mut private_key_cursor, public_key.clone(), ppk.algorithm)?;

        public_key.comment = comment.unwrap_or_default().into();

        Ok(PpkContainer {
            public_key,
            keypair_data,
        })
    }
}

fn decode_private_key_as(
    reader: &mut impl Reader,
    public: PublicKey,
    algorithm: Algorithm,
) -> Result<KeypairData, Error> {
    match (&algorithm, public.key_data()) {
        (Algorithm::Dsa, KeyData::Dsa(pk)) => {
            use crate::private::{DsaKeypair, DsaPrivateKey};

            Ok(KeypairData::Dsa(DsaKeypair::new(
                pk.clone(),
                DsaPrivateKey::decode(reader)?,
            )?))
        }

        #[cfg(feature = "rsa")]
        (Algorithm::Rsa { .. }, KeyData::Rsa(pk)) => {
            use crate::Mpint;
            use crate::private::{RsaKeypair, RsaPrivateKey};

            let d = Mpint::decode(reader)?;
            let p = Mpint::decode(reader)?;
            let q = Mpint::decode(reader)?;
            let iqmp = Mpint::decode(reader)?;
            let private = RsaPrivateKey::new(d, iqmp, p, q)?;
            Ok(KeypairData::Rsa(RsaKeypair::new(pk.clone(), private)?))
        }

        #[cfg(feature = "ed25519")]
        (Algorithm::Ed25519, KeyData::Ed25519(pk)) => {
            // PPK encodes Ed25519 private exponent as an mpint
            use crate::Mpint;
            use crate::private::{Ed25519Keypair, Ed25519PrivateKey};
            use zeroize::Zeroizing;

            // Copy and pad exponent
            let mut buf = Zeroizing::new([0u8; Ed25519PrivateKey::BYTE_SIZE]);
            let e = Mpint::decode(reader)?;
            let e_bytes = e.as_bytes();

            if e_bytes.len() > buf.len() {
                return Err(Error::Crypto);
            }

            #[allow(clippy::arithmetic_side_effects)] // length checked
            buf[Ed25519PrivateKey::BYTE_SIZE - e_bytes.len()..].copy_from_slice(e_bytes);

            let private = Ed25519PrivateKey::from_bytes(&buf);
            Ok(KeypairData::Ed25519(Ed25519Keypair {
                public: *pk,
                private,
            }))
        }

        #[cfg(any(feature = "p256", feature = "p384", feature = "p521"))]
        (Algorithm::Ecdsa { curve }, KeyData::Ecdsa(public)) => {
            // PPK encodes EcDSA private exponent as an mpint
            use crate::private::EcdsaKeypair;
            use crate::public::EcdsaPublicKey;
            use crate::{EcdsaCurve, Mpint};

            // Copy and pad exponent
            let e = Mpint::decode(reader)?;
            let e_bytes = e.as_positive_bytes().ok_or(Error::Crypto)?;
            if e_bytes.len() > curve.field_size() {
                return Err(Error::Crypto);
            }

            type Ec = EcdsaCurve;
            type Epk = EcdsaPublicKey;
            type Ekp = EcdsaKeypair;

            let keypair: Ekp = match (curve, public) {
                #[cfg(feature = "p256")]
                (Ec::NistP256, Epk::NistP256(public)) => Ekp::NistP256 {
                    public: *public,
                    private: p256::SecretKey::from_slice(e_bytes)
                        .map_err(|_| Error::Crypto)?
                        .into(),
                },
                #[cfg(feature = "p384")]
                (Ec::NistP384, Epk::NistP384(public)) => Ekp::NistP384 {
                    public: *public,
                    private: p384::SecretKey::from_slice(e_bytes)
                        .map_err(|_| Error::Crypto)?
                        .into(),
                },
                #[cfg(feature = "p521")]
                (Ec::NistP521, Epk::NistP521(public)) => Ekp::NistP521 {
                    public: *public,
                    private: p521::SecretKey::from_slice(e_bytes)
                        .map_err(|_| Error::Crypto)?
                        .into(),
                },
                _ => return Err(Error::Crypto),
            };
            Ok(keypair.into())
        }
        _ => Err(algorithm.unsupported_error()),
    }
}
