//! `sshsig` implementation.

use crate::{Algorithm, AssociatedHashAlg, Error, HashAlg, Result, Signature, SigningKey, public};
use alloc::{string::String, string::ToString, vec::Vec};
use core::str::FromStr;
use encoding::{
    CheckedSum, Decode, DecodePem, Encode, EncodePem, Reader, Writer,
    pem::{LineEnding, PemLabel},
};
use sha2::Digest;
use signature::Verifier;

#[cfg(doc)]
use crate::{PrivateKey, PublicKey};

type Version = u32;

#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize, de, ser};

/// `sshsig` provides a general-purpose signature format based on SSH keys and
/// wire formats.
///
/// These signatures can be produced using `ssh-keygen -Y sign`. They're
/// encoded as PEM and begin with the following:
///
/// ```text
/// -----BEGIN SSH SIGNATURE-----
/// ```
///
/// See [PROTOCOL.sshsig] for more information.
///
/// # Usage
///
/// See [`PrivateKey::sign`] and [`PublicKey::verify`] for usage information.
///
/// [PROTOCOL.sshsig]: https://cvsweb.openbsd.org/src/usr.bin/ssh/PROTOCOL.sshsig?annotate=HEAD
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SshSig {
    version: Version,
    public_key: public::KeyData,
    namespace: String,
    reserved: Vec<u8>,
    hash_alg: HashAlg,
    signature: Signature,
}

impl SshSig {
    /// Supported version.
    pub const VERSION: Version = 1;

    /// The preamble is the six-byte sequence "SSHSIG".
    ///
    /// It is included to ensure that manual signatures can never be confused with any message
    /// signed during SSH user or host authentication.
    const MAGIC_PREAMBLE: &'static [u8] = b"SSHSIG";

    /// Create a new signature with the given public key, namespace, hash algorithm, and signature.
    ///
    /// # Errors
    /// Returns [`Error::Namespace`] if the namespace is empty.
    pub fn new(
        public_key: public::KeyData,
        namespace: impl Into<String>,
        hash_alg: HashAlg,
        signature: Signature,
    ) -> Result<Self> {
        let version = Self::VERSION;
        let namespace = namespace.into();
        let reserved = Vec::new();

        if namespace.is_empty() {
            return Err(Error::Namespace);
        }

        Ok(Self {
            version,
            public_key,
            namespace,
            reserved,
            hash_alg,
            signature,
        })
    }

    /// Decode signature from PEM which begins with the following:
    ///
    /// ```text
    /// -----BEGIN SSH SIGNATURE-----
    /// ```
    ///
    /// # Errors
    /// Returns [`Error::Encoding`] in the event of an encoding error.
    pub fn from_pem(pem: impl AsRef<[u8]>) -> Result<Self> {
        Self::decode_pem(pem)
    }

    /// Encode signature as PEM which begins with the following:
    ///
    /// ```text
    /// -----BEGIN SSH SIGNATURE-----
    /// ```
    ///
    /// # Errors
    /// Returns [`Error::Encoding`] in the event of an encoding error.
    pub fn to_pem(&self, line_ending: LineEnding) -> Result<String> {
        Ok(self.encode_pem_string(line_ending)?)
    }

    /// Sign the given message with the provided signing key.
    ///
    /// See also: [`PrivateKey::sign`].
    ///
    /// # Errors
    /// - Returns [`Error::AlgorithmUnsupported`] if this signing key's algorithm is unsupported
    ///   by this library with its enabled features.
    /// - Returns [`Error::Crypto`] in the event of an error occurring in the cryptographic
    ///   implementation.
    /// - Returns [`Error::Namespace`] if the namespace is empty.
    pub fn sign<S: SigningKey>(
        signing_key: &S,
        namespace: &str,
        hash_alg: HashAlg,
        msg: &[u8],
    ) -> Result<Self> {
        Self::sign_prehash(
            signing_key,
            namespace,
            hash_alg,
            hash_alg.digest(msg).as_slice(),
        )
    }

    /// Sign the given message digest with the provided signing key.
    ///
    /// # Errors
    /// - Returns [`Error::AlgorithmUnsupported`] if this signing key's algorithm is unsupported
    ///   by this library with its enabled features.
    /// - Returns [`Error::Crypto`] in the event of an error occurring in the cryptographic
    ///   implementation.
    /// - Returns [`Error::Namespace`] if the namespace is empty.
    pub fn sign_digest<S, D>(signing_key: &S, namespace: &str, digest: D) -> Result<Self>
    where
        S: SigningKey,
        D: AssociatedHashAlg + Digest,
    {
        Self::sign_prehash(
            signing_key,
            namespace,
            D::HASH_ALG,
            digest.finalize().as_slice(),
        )
    }

    /// Sign the given prehashed message digest with the provided signing key.
    ///
    /// # Errors
    /// - Returns [`Error::AlgorithmUnsupported`] if this signing key's algorithm is unsupported
    ///   by this library with its enabled features.
    /// - Returns [`Error::Crypto`] in the event of an error occurring in the cryptographic
    ///   implementation.
    /// - Returns [`Error::Namespace`] if the namespace is empty.
    pub fn sign_prehash<S: SigningKey>(
        signing_key: &S,
        namespace: &str,
        hash_alg: HashAlg,
        prehash: &[u8],
    ) -> Result<Self> {
        if namespace.is_empty() {
            return Err(Error::Namespace);
        }

        if signing_key.public_key().is_sk_ed25519() {
            return Err(Algorithm::SkEd25519.unsupported_error());
        }

        #[cfg(feature = "ecdsa")]
        if signing_key.public_key().is_sk_ecdsa_p256() {
            return Err(Algorithm::SkEcdsaSha2NistP256.unsupported_error());
        }

        let signed_data = Self::signed_data_for_prehash(namespace, hash_alg, prehash)?;
        let signature = signing_key.try_sign(&signed_data)?;
        Self::new(signing_key.public_key(), namespace, hash_alg, signature)
    }

    /// Get the raw "enveloped" message over which the signature for a given input message is
    /// computed.
    ///
    /// This is a low-level function intended for uses cases which can't be expressed using
    /// [`SshSig::sign`], such as if the [`SigningKey`] trait can't be used for some reason.
    ///
    /// Once a [`Signature`] has been computed over the returned byte vector, [`SshSig::new`] can be
    /// used to construct the final signature.
    ///
    /// # Errors
    /// Returns [`Error::Namespace`] if the namespace is empty.
    pub fn signed_data(namespace: &str, hash_alg: HashAlg, msg: &[u8]) -> Result<Vec<u8>> {
        Self::signed_data_for_prehash(namespace, hash_alg, hash_alg.digest(msg).as_slice())
    }

    /// Get the raw message over which the signature for a given message digest (passed as the
    /// `prehash` parameter) is computed.
    ///
    /// # Errors
    /// - Returns [`Error::HashSize`] if `prehash` is not the right length for `hash_alg`.
    /// - Returns [`Error::Namespace`] if the namespace is empty.
    pub fn signed_data_for_prehash(
        namespace: &str,
        hash_alg: HashAlg,
        prehash: &[u8],
    ) -> Result<Vec<u8>> {
        if prehash.len() != hash_alg.digest_size() {
            return Err(Error::HashSize);
        }

        if namespace.is_empty() {
            return Err(Error::Namespace);
        }

        SignedData {
            namespace,
            reserved: &[],
            hash_alg,
            hash: prehash,
        }
        .to_bytes()
    }

    /// Verify the given prehashed message digest against this signature.
    ///
    /// Note that this method does not verify the public key or namespace are correct and thus is
    /// crate-private so as to ensure these parameters are always authenticated by users of the
    /// public API.
    pub(crate) fn verify_prehash(&self, prehash: &[u8]) -> Result<()> {
        if prehash.len() != self.hash_alg.digest_size() {
            return Err(Error::HashSize);
        }

        let signed_data = SignedData {
            namespace: self.namespace.as_str(),
            reserved: self.reserved.as_slice(),
            hash_alg: self.hash_alg,
            hash: prehash,
        }
        .to_bytes()?;

        Ok(self.public_key.verify(&signed_data, &self.signature)?)
    }

    /// Get the signature algorithm.
    #[must_use]
    pub fn algorithm(&self) -> Algorithm {
        self.signature.algorithm()
    }

    /// Get version number for this signature.
    ///
    /// Verifiers MUST reject signatures with versions greater than those
    /// they support.
    #[must_use]
    pub fn version(&self) -> Version {
        self.version
    }

    /// Get public key which corresponds to the signing key that produced
    /// this signature.
    #[must_use]
    pub fn public_key(&self) -> &public::KeyData {
        &self.public_key
    }

    /// Get the namespace (i.e. domain identifier) for this signature.
    ///
    /// The purpose of the namespace value is to specify a unambiguous
    /// interpretation domain for the signature, e.g. file signing.
    /// This prevents cross-protocol attacks caused by signatures
    /// intended for one intended domain being accepted in another.
    /// The namespace value MUST NOT be the empty string.
    #[must_use]
    pub fn namespace(&self) -> &str {
        &self.namespace
    }

    /// Get reserved data associated with this signature. Typically empty.
    ///
    /// The reserved value is present to encode future information
    /// (e.g. tags) into the signature. Implementations should ignore
    /// the reserved field if it is not empty.
    #[must_use]
    pub fn reserved(&self) -> &[u8] {
        &self.reserved
    }

    /// Get the hash algorithm used to produce this signature.
    ///
    /// Data to be signed is first hashed with the specified `hash_alg`.
    /// This is done to limit the amount of data presented to the signature
    /// operation, which may be of concern if the signing key is held in limited
    /// or slow hardware or on a remote ssh-agent. The supported hash algorithms
    /// are "sha256" and "sha512".
    #[must_use]
    pub fn hash_alg(&self) -> HashAlg {
        self.hash_alg
    }

    /// Get the structured signature over the given message.
    #[must_use]
    pub fn signature(&self) -> &Signature {
        &self.signature
    }

    /// Get the bytes which comprise the serialized signature.
    #[must_use]
    pub fn signature_bytes(&self) -> &[u8] {
        self.signature.as_bytes()
    }
}

impl Decode for SshSig {
    type Error = Error;

    fn decode(reader: &mut impl Reader) -> Result<Self> {
        let mut magic_preamble = [0u8; Self::MAGIC_PREAMBLE.len()];
        reader.read(&mut magic_preamble)?;

        if magic_preamble != Self::MAGIC_PREAMBLE {
            return Err(Error::FormatEncoding);
        }

        let version = Version::decode(reader)?;

        if version > Self::VERSION {
            return Err(Error::Version { number: version });
        }

        let public_key = reader.read_prefixed(public::KeyData::decode)?;
        let namespace = String::decode(reader)?;

        if namespace.is_empty() {
            return Err(Error::Namespace);
        }

        let reserved = Vec::decode(reader)?;
        let hash_alg = HashAlg::decode(reader)?;
        let signature = reader.read_prefixed(Signature::decode)?;

        Ok(Self {
            version,
            public_key,
            namespace,
            reserved,
            hash_alg,
            signature,
        })
    }
}

impl Encode for SshSig {
    fn encoded_len(&self) -> encoding::Result<usize> {
        [
            Self::MAGIC_PREAMBLE.len(),
            self.version.encoded_len()?,
            self.public_key.encoded_len_prefixed()?,
            self.namespace.encoded_len()?,
            self.reserved.encoded_len()?,
            self.hash_alg.encoded_len()?,
            self.signature.encoded_len_prefixed()?,
        ]
        .checked_sum()
    }

    fn encode(&self, writer: &mut impl Writer) -> encoding::Result<()> {
        writer.write(Self::MAGIC_PREAMBLE)?;
        self.version.encode(writer)?;
        self.public_key.encode_prefixed(writer)?;
        self.namespace.encode(writer)?;
        self.reserved.encode(writer)?;
        self.hash_alg.encode(writer)?;
        self.signature.encode_prefixed(writer)?;
        Ok(())
    }
}

impl FromStr for SshSig {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self> {
        Self::from_pem(s)
    }
}

impl PemLabel for SshSig {
    const PEM_LABEL: &'static str = "SSH SIGNATURE";
}

#[allow(clippy::to_string_trait_impl)]
impl ToString for SshSig {
    fn to_string(&self) -> String {
        self.to_pem(LineEnding::default())
            .expect("SSH signature encoding error")
    }
}

/// Data to be signed.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct SignedData<'a> {
    namespace: &'a str,
    reserved: &'a [u8],
    hash_alg: HashAlg,
    hash: &'a [u8],
}

impl SignedData<'_> {
    fn to_bytes(self) -> Result<Vec<u8>> {
        let mut signed_bytes = Vec::with_capacity(self.encoded_len()?);
        self.encode(&mut signed_bytes)?;
        Ok(signed_bytes)
    }
}

impl Encode for SignedData<'_> {
    fn encoded_len(&self) -> encoding::Result<usize> {
        [
            SshSig::MAGIC_PREAMBLE.len(),
            self.namespace.encoded_len()?,
            self.reserved.encoded_len()?,
            self.hash_alg.encoded_len()?,
            self.hash.encoded_len()?,
        ]
        .checked_sum()
    }

    fn encode(&self, writer: &mut impl Writer) -> encoding::Result<()> {
        writer.write(SshSig::MAGIC_PREAMBLE)?;
        self.namespace.encode(writer)?;
        self.reserved.encode(writer)?;
        self.hash_alg.encode(writer)?;
        self.hash.encode(writer)?;
        Ok(())
    }
}

#[cfg(feature = "serde")]
impl<'de> Deserialize<'de> for SshSig {
    fn deserialize<D>(deserializer: D) -> core::result::Result<Self, D::Error>
    where
        D: de::Deserializer<'de>,
    {
        if deserializer.is_human_readable() {
            let string = String::deserialize(deserializer)?;
            string.parse::<SshSig>().map_err(de::Error::custom)
        } else {
            let bytes = Vec::<u8>::deserialize(deserializer)?;
            Self::decode(&mut bytes.as_slice()).map_err(de::Error::custom)
        }
    }
}

#[cfg(feature = "serde")]
impl Serialize for SshSig {
    fn serialize<S>(&self, serializer: S) -> core::result::Result<S::Ok, S::Error>
    where
        S: ser::Serializer,
    {
        if serializer.is_human_readable() {
            self.to_pem(LineEnding::LF)
                .map_err(ser::Error::custom)?
                .serialize(serializer)
        } else {
            let bytes = self.encode_vec().map_err(ser::Error::custom)?;
            bytes.serialize(serializer)
        }
    }
}
