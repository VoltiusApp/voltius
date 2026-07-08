//! OpenSSH certificate support.

mod builder;
mod cert_type;
mod field;
mod options_map;
mod unix_time;

pub use self::{builder::Builder, cert_type::CertType, field::Field, options_map::OptionsMap};

use crate::{
    Algorithm, Comment, Error, Fingerprint, HashAlg, Result, Signature,
    public::{KeyData, SshFormat},
};
use alloc::{
    string::{String, ToString},
    vec::Vec,
};
use core::str::FromStr;
use encoding::{Base64Reader, CheckedSum, Decode, Encode, Reader, Writer};
use signature::Verifier;

#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize, de, ser};

#[cfg(feature = "std")]
use {
    self::unix_time::UnixTime,
    std::{fs, path::Path, time::SystemTime},
};

/// OpenSSH certificate as specified in [PROTOCOL.certkeys].
///
/// OpenSSH supports X.509-like certificate authorities, but using a custom
/// encoding format.
///
/// <div class="warning">
/// <b>Security Warning</b>
///
/// Certificates must be validated before they can be trusted!
///
/// The [`Certificate`] type does not automatically perform validation checks
/// and supports parsing certificates which may potentially be invalid.
/// Just because a [`Certificate`] parses successfully does not mean that it
/// can be trusted.
///
/// See "Certificate Validation" documentation below for more information on
/// how to properly validate certificates.
/// </div>
///
/// # Certificate Validation
///
/// For a certificate to be trusted, the following properties MUST be
/// validated:
///
/// - Certificate is signed by a trusted certificate authority (CA)
/// - Signature over the certificate verifies successfully
/// - Current time is within the certificate's validity window
/// - Certificate authorizes the expected principal
/// - All critical extensions to the certificate are recognized and validate
///   successfully.
///
/// The [`Certificate::validate`] and [`Certificate::validate_at`] methods can
/// be used to validate a certificate.
///
/// ## Example
///
/// The following example walks through how to implement the steps outlined
/// above for validating a certificate:
///
#[cfg_attr(all(feature = "p256", feature = "std"), doc = " ```")]
#[cfg_attr(not(all(feature = "p256", feature = "std")), doc = " ```ignore")]
/// # fn main() -> Result<(), ssh_key::Error> {
/// use ssh_key::{Certificate, Fingerprint};
/// use std::str::FromStr;
///
/// // List of trusted certificate authority (CA) fingerprints
/// let ca_fingerprints = [
///     Fingerprint::from_str("SHA256:JQ6FV0rf7qqJHZqIj4zNH8eV0oB8KLKh9Pph3FTD98g")?
/// ];
///
/// // Certificate to be validated
/// let certificate = Certificate::from_str(
///     "ssh-ed25519-cert-v01@openssh.com AAAAIHNzaC1lZDI1NTE5LWNlcnQtdjAxQG9wZW5zc2guY29tAAAAIE7x9ln6uZLLkfXM8iatrnAAuytVHeCznU8VlEgx7TvLAAAAILM+rvN+ot98qgEN796jTiQfZfG1KaT0PtFDJ/XFSqtiAAAAAAAAAAAAAAABAAAAFGVkMjU1MTktd2l0aC1wMjU2LWNhAAAAAAAAAABiUZm7AAAAAPTaMrsAAAAAAAAAggAAABVwZXJtaXQtWDExLWZvcndhcmRpbmcAAAAAAAAAF3Blcm1pdC1hZ2VudC1mb3J3YXJkaW5nAAAAAAAAABZwZXJtaXQtcG9ydC1mb3J3YXJkaW5nAAAAAAAAAApwZXJtaXQtcHR5AAAAAAAAAA5wZXJtaXQtdXNlci1yYwAAAAAAAAAAAAAAaAAAABNlY2RzYS1zaGEyLW5pc3RwMjU2AAAACG5pc3RwMjU2AAAAQQR8H9hzDOU0V76NkkCY7DZIgw+SqoojY6xlb91FIfpjE+UR8YkbTp5ar44ULQatFaZqQlfz8FHYTooOL5G6gHBHAAAAZAAAABNlY2RzYS1zaGEyLW5pc3RwMjU2AAAASQAAACEA/0Cwxhkac5AeNYE958j8GgvmkIESDH1TE7QYIqxsFsIAAAAgTEw8WVjlz8AnvyaKGOUELMpyFFJagtD2JFAIAJvilrc= user@example.com"
/// )?;
///
/// // Perform basic certificate validation, ensuring that the certificate is
/// // signed by a trusted certificate authority (CA) and checking that the
/// // current system clock time is within the certificate's validity window
/// certificate.validate(&ca_fingerprints)?;
///
/// // Check that the certificate includes the expected principal name
/// // (i.e. username or hostname)
/// // if !certificate.principals().contains(expected_principal) { return Err(...) }
///
/// // Check that all of the critical extensions are recognized
/// // if !certificate.critical_options.iter().all(|critical| ...) { return Err(...) }
///
/// // If we've made it this far, the certificate can be trusted
/// Ok(())
/// # }
/// ```
///
/// # Certificate Builder (SSH CA support)
///
/// This crate implements all of the functionality needed for a pure Rust
/// SSH certificate authority which can build and sign OpenSSH certificates.
///
/// See the [`Builder`] type's documentation for more information.
///
/// # `serde` support
///
/// When the `serde` feature of this crate is enabled, this type receives impls
/// of [`Deserialize`][`serde::Deserialize`] and [`Serialize`][`serde::Serialize`].
///
/// The serialization uses a binary encoding with binary formats like bincode
/// and CBOR, and the OpenSSH string serialization when used with
/// human-readable formats like JSON and TOML.
///
/// [PROTOCOL.certkeys]: https://cvsweb.openbsd.org/src/usr.bin/ssh/PROTOCOL.certkeys?annotate=HEAD
#[derive(Clone, Debug, Eq, Hash, PartialEq, PartialOrd, Ord)]
pub struct Certificate {
    /// CA-provided random bitstring of arbitrary length
    /// (but typically 16 or 32 bytes).
    nonce: Vec<u8>,

    /// Public key data.
    public_key: KeyData,

    /// Serial number.
    serial: u64,

    /// Certificate type.
    cert_type: CertType,

    /// Key ID.
    key_id: String,

    /// Valid principals.
    valid_principals: Vec<String>,

    /// Valid after.
    valid_after: u64,

    /// Valid before.
    valid_before: u64,

    /// Critical options.
    critical_options: OptionsMap,

    /// Extensions.
    extensions: OptionsMap,

    /// Reserved field.
    reserved: Vec<u8>,

    /// Signature key of signing CA.
    signature_key: KeyData,

    /// Signature over the certificate.
    signature: Signature,

    /// Comment on the certificate.
    comment: Comment,
}

impl Certificate {
    /// Parse an OpenSSH-formatted certificate.
    ///
    /// OpenSSH-formatted certificates look like the following
    /// (i.e. similar to OpenSSH public keys with `-cert-v01@openssh.com`):
    ///
    /// ```text
    /// ssh-ed25519-cert-v01@openssh.com AAAAIHNzaC1lZDI1NTE5LWNlc...8REbCaAw== user@example.com
    /// ```
    ///
    /// # Errors
    /// - Returns [`Error::AlgorithmUnknown`] in the event of an algorithm mismatch.
    /// - Returns [`Error::Encoding`] in the event of an encoding error.
    pub fn from_openssh(certificate_str: &str) -> Result<Self> {
        let encapsulation = SshFormat::decode(certificate_str.trim_end().as_bytes())?;
        let mut reader = Base64Reader::new(encapsulation.base64_data)?;
        let mut cert = Certificate::decode(&mut reader)?;

        // Verify that the algorithm in the Base64-encoded data matches the text
        if encapsulation.algorithm_id != cert.algorithm().to_certificate_type() {
            return Err(Error::AlgorithmUnknown);
        }

        cert.comment = Comment::from(encapsulation.comment);
        Ok(reader.finish(cert)?)
    }

    /// Parse a raw binary OpenSSH certificate.
    ///
    /// # Errors
    /// Returns [`Error::Encoding`] in the event of an encoding error.
    pub fn from_bytes(mut bytes: &[u8]) -> Result<Self> {
        let reader = &mut bytes;
        let cert = Certificate::decode(reader)?;
        Ok(reader.finish(cert)?)
    }

    /// Encode OpenSSH certificate to a [`String`].
    ///
    /// # Errors
    /// Returns [`Error::Encoding`] in the event of an encoding error.
    pub fn to_openssh(&self) -> Result<String> {
        SshFormat::encode_string(
            &self.algorithm().to_certificate_type(),
            self,
            self.comment(),
        )
    }

    /// Serialize OpenSSH certificate as raw bytes.
    ///
    /// # Errors
    /// Returns [`Error::Encoding`] in the event of an encoding error.
    pub fn to_bytes(&self) -> Result<Vec<u8>> {
        Ok(self.encode_vec()?)
    }

    /// Read OpenSSH certificate from a file.
    ///
    /// # Errors
    /// - Returns [`Error::Io`] in the event of an I/O error.
    /// - Returns [`Error::Encoding`] in the event of an encoding error.
    #[cfg(feature = "std")]
    pub fn read_file(path: &Path) -> Result<Self> {
        let input = fs::read_to_string(path)?;
        Self::from_openssh(&input)
    }

    /// Write OpenSSH certificate to a file.
    ///
    /// # Errors
    /// - Returns [`Error::Io`] in the event of an I/O error.
    /// - Returns [`Error::Encoding`] in the event of an encoding error.
    #[cfg(feature = "std")]
    pub fn write_file(&self, path: &Path) -> Result<()> {
        let encoded = self.to_openssh()?;
        fs::write(path, encoded.as_bytes())?;
        Ok(())
    }

    /// Get the public key algorithm for this certificate.
    #[must_use]
    pub fn algorithm(&self) -> Algorithm {
        self.public_key.algorithm()
    }

    /// Get the comment on this certificate.
    #[must_use]
    pub fn comment(&self) -> &str {
        self.comment.as_str_lossy()
    }

    /// Set the comment on this certificate.
    pub fn set_comment(&mut self, comment: impl Into<Comment>) {
        self.comment = comment.into();
    }

    /// Nonces are a CA-provided random bitstring of arbitrary length
    /// (but typically 16 or 32 bytes).
    ///
    /// It's included to make attacks that depend on inducing collisions in the
    /// signature hash infeasible.
    #[must_use]
    pub fn nonce(&self) -> &[u8] {
        &self.nonce
    }

    /// Get this certificate's public key data.
    #[must_use]
    pub fn public_key(&self) -> &KeyData {
        &self.public_key
    }

    /// Optional certificate serial number set by the CA to provide an
    /// abbreviated way to refer to certificates from that CA.
    ///
    /// If a CA does not wish to number its certificates, it must set this
    /// field to zero.
    #[must_use]
    pub fn serial(&self) -> u64 {
        self.serial
    }

    /// Specifies whether this certificate is for identification of a user or
    /// a host.
    #[must_use]
    pub fn cert_type(&self) -> CertType {
        self.cert_type
    }

    /// Key IDs are a free-form text field that is filled in by the CA at the
    /// time of signing.
    ///
    /// The intention is that the contents of this field are used to identify
    /// the identity principal in log messages.
    #[must_use]
    pub fn key_id(&self) -> &str {
        &self.key_id
    }

    /// List of zero or more principals which this certificate is valid for.
    ///
    /// Principals are hostnames for host certificates and usernames for user
    /// certificates.
    ///
    /// As a special case, a zero-length "valid principals" field means the
    /// certificate is valid for any principal of the specified type.
    #[must_use]
    pub fn valid_principals(&self) -> &[String] {
        &self.valid_principals
    }

    /// Valid after (Unix time), i.e. certificate issuance time.
    #[must_use]
    pub fn valid_after(&self) -> u64 {
        self.valid_after
    }

    /// Valid before (Unix time), i.e. certificate expiration time.
    #[must_use]
    pub fn valid_before(&self) -> u64 {
        self.valid_before
    }

    /// Valid after (system time), i.e. certificate issuance time.
    ///
    /// # Returns
    /// - `Some` if the `u64` value is a valid `SystemTime`
    /// - `None` if it is not (i.e. overflows `i64`)
    #[cfg(feature = "std")]
    pub fn valid_after_time(&self) -> Option<SystemTime> {
        UnixTime::try_from(self.valid_after).ok().map(Into::into)
    }

    /// Valid before (system time), i.e. certificate expiration time.
    ///
    /// # Returns
    /// - `Some` if the `u64` value is a valid `SystemTime`
    /// - `None` if it is not (i.e. overflows `i64`, effectively never-expiring)
    #[cfg(feature = "std")]
    pub fn valid_before_time(&self) -> Option<SystemTime> {
        UnixTime::try_from(self.valid_before).ok().map(Into::into)
    }

    /// The critical options section of the certificate specifies zero or more
    /// options on the certificate's validity.
    ///
    /// Each named option may only appear once in a certificate.
    ///
    /// All options are "critical"; if an implementation does not recognize an
    /// option, then the validating party should refuse to accept the
    /// certificate.
    #[must_use]
    pub fn critical_options(&self) -> &OptionsMap {
        &self.critical_options
    }

    /// The extensions section of the certificate specifies zero or more
    /// non-critical certificate extensions.
    ///
    /// If an implementation does not recognise an extension, then it should
    /// ignore it.
    #[must_use]
    pub fn extensions(&self) -> &OptionsMap {
        &self.extensions
    }

    /// Signature key of signing CA.
    #[must_use]
    pub fn signature_key(&self) -> &KeyData {
        &self.signature_key
    }

    /// Signature computed over all preceding fields from the initial string up
    /// to, and including the signature key.
    #[must_use]
    pub fn signature(&self) -> &Signature {
        &self.signature
    }

    /// Perform certificate validation using the system clock to check that
    /// the current time is within the certificate's validity window.
    ///
    /// <div class="warning">
    /// <b>Security Warning: Some Assembly Required</b>
    ///
    /// See [`Certificate::validate_at`] documentation for important notes on how to properly
    /// validate certificates!
    /// </div>
    ///
    /// # Errors
    /// Returns [`Error::CertificateValidation`] if the certificate failed to validate
    #[cfg(feature = "std")]
    pub fn validate<'a, I>(&self, ca_fingerprints: I) -> Result<()>
    where
        I: IntoIterator<Item = &'a Fingerprint>,
    {
        self.validate_at(UnixTime::now()?.into(), ca_fingerprints)
    }

    /// Perform certificate validation.
    ///
    /// Checks for the following:
    ///
    /// - Specified Unix timestamp is within the certificate's valid range
    /// - Certificate's signature validates against the public key included in the certificate
    /// - Fingerprint of the public key included in the certificate matches one of the trusted
    ///   certificate authority (CA) fingerprints provided in the `ca_fingerprints` parameter.
    ///
    /// NOTE: only SHA-256 fingerprints are supported at this time.
    ///
    /// <div class="warning">
    /// <b>Security Warning: Some Assembly Required</b>
    ///
    /// This method does not perform the full set of validation checks needed to determine if a
    /// certificate is to be trusted.
    ///
    /// If this method succeeds, the following properties still need to be checked to ensure the
    /// certificate is valid:
    ///
    /// - `valid_principals` is empty or contains the expected principal.
    /// - `critical_options` is empty or contains *only* options which are recognized, and that the
    ///   recognized options are all valid.
    /// </div>
    ///
    /// # Errors
    /// Returns [`Error::CertificateValidation`] if the certificate failed to validate
    pub fn validate_at<'a, I>(&self, unix_timestamp: u64, ca_fingerprints: I) -> Result<()>
    where
        I: IntoIterator<Item = &'a Fingerprint>,
    {
        self.verify_signature()?;

        // TODO(tarcieri): support non SHA-256 public key fingerprints?
        let cert_fingerprint = self.signature_key.fingerprint(HashAlg::Sha256);

        if !ca_fingerprints.into_iter().any(|f| f == &cert_fingerprint) {
            return Err(Error::CertificateValidation);
        }

        // From PROTOCOL.certkeys:
        //
        //  "valid after" and "valid before" specify a validity period for the
        //  certificate. Each represents a time in seconds since 1970-01-01
        //  A certificate is considered valid if:
        //
        //     valid after <= current time < valid before
        if self.valid_after <= unix_timestamp && unix_timestamp < self.valid_before {
            Ok(())
        } else {
            Err(Error::CertificateValidation)
        }
    }

    /// Verify the signature on the certificate against the public key in the
    /// certificate.
    ///
    /// <div class="warning">
    /// <b>Security Warning: DON'T USE THIS!</b>
    ///
    /// This function alone does not provide any security guarantees whatsoever.
    ///
    /// It verifies the signature in the certificate matches the CA public key in the certificate,
    /// but does not ensure the CA is trusted.
    ///
    /// It is public only for testing purposes, and deliberately hidden from the documentation for
    /// that reason.
    /// </div>
    #[doc(hidden)]
    pub fn verify_signature(&self) -> Result<()> {
        let mut tbs_certificate = Vec::new();
        self.encode_tbs(&mut tbs_certificate)?;
        self.signature_key
            .verify(&tbs_certificate, &self.signature)
            .map_err(|_| Error::CertificateValidation)
    }

    /// Encode the portion of the certificate "to be signed" by the CA
    /// (or to be verified against an existing CA signature)
    fn encode_tbs(&self, writer: &mut impl Writer) -> encoding::Result<()> {
        self.algorithm().to_certificate_type().encode(writer)?;
        self.nonce.encode(writer)?;
        self.public_key.encode_key_data(writer)?;
        self.serial.encode(writer)?;
        self.cert_type.encode(writer)?;
        self.key_id.encode(writer)?;
        self.valid_principals.encode(writer)?;
        self.valid_after.encode(writer)?;
        self.valid_before.encode(writer)?;
        self.critical_options.encode(writer)?;
        self.extensions.encode(writer)?;
        self.reserved.encode(writer)?;
        self.signature_key.encode_prefixed(writer)
    }

    /// Decode [`Certificate`] for the specified algorithm.
    ///
    /// # Errors
    /// Returns [`Error::Encoding`] in the event of an encoding error.
    pub fn decode_as(reader: &mut impl Reader, algorithm: Algorithm) -> Result<Self> {
        Ok(Self {
            nonce: Vec::decode(reader)?,
            public_key: KeyData::decode_as(reader, algorithm)?,
            serial: u64::decode(reader)?,
            cert_type: CertType::decode(reader)?,
            key_id: String::decode(reader)?,
            valid_principals: Vec::decode(reader)?,
            valid_after: u64::decode(reader)?,
            valid_before: u64::decode(reader)?,
            critical_options: OptionsMap::decode(reader)?,
            extensions: OptionsMap::decode(reader)?,
            reserved: Vec::decode(reader)?,
            signature_key: reader.read_prefixed(KeyData::decode)?,
            signature: reader.read_prefixed(Signature::decode)?,
            comment: Comment::default(),
        })
    }
}

impl Decode for Certificate {
    type Error = Error;

    fn decode(reader: &mut impl Reader) -> Result<Self> {
        let algorithm = Algorithm::new_certificate(&String::decode(reader)?)?;
        Self::decode_as(reader, algorithm)
    }
}

impl Encode for Certificate {
    fn encoded_len(&self) -> encoding::Result<usize> {
        [
            self.algorithm().to_certificate_type().encoded_len()?,
            self.nonce.encoded_len()?,
            self.public_key.encoded_key_data_len()?,
            self.serial.encoded_len()?,
            self.cert_type.encoded_len()?,
            self.key_id.encoded_len()?,
            self.valid_principals.encoded_len()?,
            self.valid_after.encoded_len()?,
            self.valid_before.encoded_len()?,
            self.critical_options.encoded_len()?,
            self.extensions.encoded_len()?,
            self.reserved.encoded_len()?,
            self.signature_key.encoded_len_prefixed()?,
            self.signature.encoded_len_prefixed()?,
        ]
        .checked_sum()
    }

    fn encode(&self, writer: &mut impl Writer) -> encoding::Result<()> {
        self.encode_tbs(writer)?;
        self.signature.encode_prefixed(writer)
    }
}

impl FromStr for Certificate {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self> {
        Self::from_openssh(s)
    }
}

#[allow(
    clippy::to_string_trait_impl,
    reason = "`SshFormat` lacks `core::fmt` support"
)]
impl ToString for Certificate {
    fn to_string(&self) -> String {
        self.to_openssh().expect("SSH certificate encoding error")
    }
}

#[cfg(feature = "serde")]
impl<'de> Deserialize<'de> for Certificate {
    fn deserialize<D>(deserializer: D) -> core::result::Result<Self, D::Error>
    where
        D: de::Deserializer<'de>,
    {
        if deserializer.is_human_readable() {
            let string = String::deserialize(deserializer)?;
            Self::from_openssh(&string).map_err(de::Error::custom)
        } else {
            let bytes = Vec::<u8>::deserialize(deserializer)?;
            Self::from_bytes(&bytes).map_err(de::Error::custom)
        }
    }
}

#[cfg(feature = "serde")]
impl Serialize for Certificate {
    fn serialize<S>(&self, serializer: S) -> core::result::Result<S::Ok, S::Error>
    where
        S: ser::Serializer,
    {
        if serializer.is_human_readable() {
            self.to_openssh()
                .map_err(ser::Error::custom)?
                .serialize(serializer)
        } else {
            self.to_bytes()
                .map_err(ser::Error::custom)?
                .serialize(serializer)
        }
    }
}
