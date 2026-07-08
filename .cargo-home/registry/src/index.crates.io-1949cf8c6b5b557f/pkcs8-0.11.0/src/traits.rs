//! Traits for parsing objects from PKCS#8 encoded documents

use crate::{Error, PrivateKeyInfoRef, Result};

#[cfg(feature = "alloc")]
use der::SecretDocument;

#[cfg(feature = "encryption")]
use crate::EncryptedPrivateKeyInfoRef;

#[cfg(feature = "pem")]
use {
    crate::LineEnding,
    alloc::string::String,
    der::{
        pem::{self, PemLabel},
        zeroize::Zeroizing,
    },
};

#[cfg(feature = "std")]
use std::path::Path;

/// Parse a private key object from a PKCS#8 encoded document.
pub trait DecodePrivateKey: Sized {
    /// Deserialize PKCS#8 private key from ASN.1 DER-encoded data (binary format).
    ///
    /// # Errors
    /// Returns format-specific errors in the event the document failed to parse.
    fn from_pkcs8_der(bytes: &[u8]) -> Result<Self>;

    /// Deserialize encrypted PKCS#8 private key from ASN.1 DER-encoded data (binary format) and
    /// attempt to decrypt it using the provided password.
    ///
    /// # Errors
    /// - Returns errors if the DER failed to decode
    /// - Returns errors if the ciphertext failed to decrypt under the given password
    #[cfg(feature = "encryption")]
    fn from_pkcs8_encrypted_der(bytes: &[u8], password: impl AsRef<[u8]>) -> Result<Self> {
        let doc = EncryptedPrivateKeyInfoRef::try_from(bytes)?.decrypt(password)?;
        Self::from_pkcs8_der(doc.as_bytes())
    }

    /// Deserialize PKCS#8-encoded private key from PEM.
    ///
    /// Keys in this format begin with the following delimiter:
    ///
    /// ```text
    /// -----BEGIN PRIVATE KEY-----
    /// ```
    ///
    /// # Errors
    /// - Returns [`Error::Asn1`] in the event of a decoding error (PEM or DER).
    /// - Returns the same errors as [`DecodePrivateKey::from_pkcs8_der`].
    #[cfg(feature = "pem")]
    fn from_pkcs8_pem(s: &str) -> Result<Self> {
        // Validate PEM label
        let label = pem::decode_label(s.as_bytes())?;
        PrivateKeyInfoRef::validate_pem_label(label)?;

        let doc = SecretDocument::from_pem(s)?.1;
        Self::from_pkcs8_der(doc.as_bytes())
    }

    /// Deserialize encrypted PKCS#8-encoded private key from PEM and attempt to decrypt it using
    /// the provided password.
    ///
    /// Keys in this format begin with the following delimiter:
    ///
    /// ```text
    /// -----BEGIN ENCRYPTED PRIVATE KEY-----
    /// ```
    ///
    /// # Errors
    /// - Returns [`Error::Asn1`] in the event of a decoding error (PEM or DER).
    /// - Returns the same errors as [`DecodePrivateKey::from_pkcs8_encrypted_der`].
    #[cfg(all(feature = "encryption", feature = "pem"))]
    fn from_pkcs8_encrypted_pem(s: &str, password: impl AsRef<[u8]>) -> Result<Self> {
        let (label, doc) = SecretDocument::from_pem(s)?;
        EncryptedPrivateKeyInfoRef::validate_pem_label(label)?;
        Self::from_pkcs8_encrypted_der(doc.as_bytes(), password)
    }

    /// Load PKCS#8 private key from an ASN.1 DER-encoded file (binary format) on the local
    /// filesystem.
    ///
    /// # Errors
    /// - Returns the same errors as [`DecodePrivateKey::from_pkcs8_der`].
    /// - Returns errors in event the file cannot be read from the filesystem.
    #[cfg(feature = "std")]
    fn read_pkcs8_der_file(path: impl AsRef<Path>) -> Result<Self> {
        Self::from_pkcs8_der(SecretDocument::read_der_file(path)?.as_bytes())
    }

    /// Load PKCS#8 private key from a PEM-encoded file on the local filesystem.
    ///
    /// # Errors
    /// - Returns the same errors as [`SecretDocument::read_pem_file`].
    /// - Returns the same errors as [`DecodePrivateKey::from_pkcs8_der`].
    /// - Returns errors in event the file cannot be read from the filesystem.
    #[cfg(all(feature = "pem", feature = "std"))]
    fn read_pkcs8_pem_file(path: impl AsRef<Path>) -> Result<Self> {
        let (label, doc) = SecretDocument::read_pem_file(path)?;
        PrivateKeyInfoRef::validate_pem_label(&label)?;
        Self::from_pkcs8_der(doc.as_bytes())
    }
}

impl<T> DecodePrivateKey for T
where
    T: for<'a> TryFrom<PrivateKeyInfoRef<'a>, Error = Error>,
{
    fn from_pkcs8_der(bytes: &[u8]) -> Result<Self> {
        Self::try_from(PrivateKeyInfoRef::try_from(bytes)?)
    }
}

/// Serialize a private key object to a PKCS#8 encoded document.
#[cfg(feature = "alloc")]
pub trait EncodePrivateKey {
    /// Serialize a [`SecretDocument`] containing a PKCS#8-encoded private key.
    ///
    /// # Errors
    /// Returns format-specific errors in the event the document failed to serialize.
    fn to_pkcs8_der(&self) -> Result<SecretDocument>;

    /// Create an [`SecretDocument`] containing the ciphertext of a PKCS#8 encoded private key
    /// encrypted under the given `password`.
    ///
    /// # Errors
    /// - Returns format-specific errors in the event the document failed to serialize.
    /// - Returns algorithm-specific errors in the event the document couldn't be encrypted.
    #[cfg(feature = "getrandom")]
    fn to_pkcs8_encrypted_der(&self, password: impl AsRef<[u8]>) -> Result<SecretDocument> {
        EncryptedPrivateKeyInfoRef::encrypt(password, self.to_pkcs8_der()?.as_bytes())
    }

    /// Serialize this private key as PEM-encoded PKCS#8 with the given [`LineEnding`].
    ///
    /// # Errors
    /// - Returns the same errors as [`EncodePrivateKey::to_pkcs8_der`].
    /// - Returns the same errors as [`SecretDocument::to_pem`].
    #[cfg(feature = "pem")]
    fn to_pkcs8_pem(&self, line_ending: LineEnding) -> Result<Zeroizing<String>> {
        let doc = self.to_pkcs8_der()?;
        Ok(doc.to_pem(PrivateKeyInfoRef::PEM_LABEL, line_ending)?)
    }

    /// Serialize this private key as an encrypted PEM-encoded PKCS#8 private key using the
    /// `provided` to derive an encryption key.
    ///
    /// # Errors
    /// - Returns the same errors as [`EncodePrivateKey::to_pkcs8_encrypted_der`].
    /// - Returns the same errors as [`SecretDocument::to_pem`].
    #[cfg(all(feature = "getrandom", feature = "pem"))]
    fn to_pkcs8_encrypted_pem(
        &self,
        password: impl AsRef<[u8]>,
        line_ending: LineEnding,
    ) -> Result<Zeroizing<String>> {
        let doc = self.to_pkcs8_encrypted_der(password)?;
        Ok(doc.to_pem(EncryptedPrivateKeyInfoRef::PEM_LABEL, line_ending)?)
    }

    /// Write ASN.1 DER-encoded PKCS#8 private key to the given path.
    ///
    /// # Errors
    /// - Returns the same errors as [`EncodePrivateKey::to_pkcs8_der`].
    /// - Returns errors in the event the file could not be written to the filesystem.
    #[cfg(feature = "std")]
    fn write_pkcs8_der_file(&self, path: impl AsRef<Path>) -> Result<()> {
        Ok(self.to_pkcs8_der()?.write_der_file(path)?)
    }

    /// Write ASN.1 PEM-encoded PKCS#8 private key to the given path.
    ///
    /// # Errors
    /// - Returns the same errors as [`EncodePrivateKey::to_pkcs8_der`].
    /// - Returns errors in the event the file could not be written to the filesystem.
    #[cfg(all(feature = "pem", feature = "std"))]
    fn write_pkcs8_pem_file(&self, path: impl AsRef<Path>, line_ending: LineEnding) -> Result<()> {
        let doc = self.to_pkcs8_der()?;
        Ok(doc.write_pem_file(path, PrivateKeyInfoRef::PEM_LABEL, line_ending)?)
    }
}
