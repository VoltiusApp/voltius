//! `~/.ssh` support.

use crate::{Fingerprint, PrivateKey, PublicKey, Result};
use core::fmt::{self, Debug};
use std::{
    env,
    fs::{self, ReadDir},
    path::{Path, PathBuf},
};

#[cfg(doc)]
use crate::Error;

/// `~/.ssh` directory support (or similarly structured directories).
#[derive(Clone, Eq, PartialEq)]
pub struct DotSsh {
    path: PathBuf,
}

impl DotSsh {
    /// Open `~/.ssh` if the home directory can be located.
    ///
    /// Returns `None` if the home directory couldn't be located.
    #[must_use]
    pub fn new() -> Option<Self> {
        #[allow(deprecated, reason = "TODO MSRV: Rust 1.86 un-deprecates this")]
        env::home_dir().map(|path| Self::open(path.join(".ssh")))
    }

    /// Open a `~/.ssh`-structured directory.
    ///
    /// Does not verify that the directory exists or has the right file permissions.
    ///
    /// Attempts to canonicalize the path once opened.
    pub fn open(path: impl Into<PathBuf>) -> Self {
        let path = path.into();
        Self {
            path: path.canonicalize().unwrap_or(path),
        }
    }

    /// Get the path to the `~/.ssh` directory (or whatever [`DotSsh::open`] was called with).
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Get the path to the `~/.ssh/config` configuration file. Does not check if it exists.
    #[must_use]
    pub fn config_path(&self) -> PathBuf {
        self.path.join("config")
    }

    /// Iterate over the private keys in the `~/.ssh` directory.
    ///
    /// # Errors
    /// Returns [`Error::Io`] in the event of I/O errors.
    pub fn private_keys(&self) -> Result<impl Iterator<Item = PrivateKey>> {
        Ok(PrivateKeysIter {
            read_dir: fs::read_dir(&self.path)?,
        })
    }

    /// Find a private key whose public key has the given key fingerprint.
    #[must_use]
    pub fn private_key_with_fingerprint(&self, fingerprint: Fingerprint) -> Option<PrivateKey> {
        self.private_keys()
            .ok()?
            .find(|key| key.public_key().fingerprint(fingerprint.algorithm()) == fingerprint)
    }

    /// Iterate over the public keys in the `~/.ssh` directory.
    ///
    /// # Errors
    /// Returns [`Error::Io`] in the event of I/O errors.
    pub fn public_keys(&self) -> Result<impl Iterator<Item = PublicKey>> {
        Ok(PublicKeysIter {
            read_dir: fs::read_dir(&self.path)?,
        })
    }

    /// Find a public key with the given key fingerprint.
    #[must_use]
    pub fn public_key_with_fingerprint(&self, fingerprint: Fingerprint) -> Option<PublicKey> {
        self.public_keys()
            .ok()?
            .find(|key| key.fingerprint(fingerprint.algorithm()) == fingerprint)
    }

    /// Write a private key into `~/.ssh`.
    ///
    /// # Errors
    /// Returns [`Error::Io`] in the event of I/O errors.
    pub fn write_private_key(&self, filename: impl AsRef<Path>, key: &PrivateKey) -> Result<()> {
        key.write_openssh_file(self.path.join(filename), Default::default())
    }

    /// Write a public key into `~/.ssh`.
    ///
    /// # Errors
    /// Returns [`Error::Io`] in the event of I/O errors.
    pub fn write_public_key(&self, filename: impl AsRef<Path>, key: &PublicKey) -> Result<()> {
        key.write_openssh_file(self.path.join(filename))
    }
}

impl Debug for DotSsh {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("DotSsh").finish_non_exhaustive()
    }
}

impl Default for DotSsh {
    /// Calls [`DotSsh::new`] and panics if the home directory could not be located.
    fn default() -> Self {
        Self::new().expect("home directory could not be located")
    }
}

/// Iterator over the private keys in the `~/.ssh` directory.
pub(crate) struct PrivateKeysIter {
    read_dir: ReadDir,
}

impl Iterator for PrivateKeysIter {
    type Item = PrivateKey;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            let entry = self.read_dir.next()?.ok()?;

            if let Ok(key) = PrivateKey::read_openssh_file(entry.path()) {
                return Some(key);
            }
        }
    }
}

/// Iterator over the public keys in the `~/.ssh` directory.
pub(crate) struct PublicKeysIter {
    read_dir: ReadDir,
}

impl Iterator for PublicKeysIter {
    type Item = PublicKey;

    fn next(&mut self) -> Option<Self::Item> {
        loop {
            let entry = self.read_dir.next()?.ok()?;

            if let Ok(key) = PublicKey::read_openssh_file(entry.path()) {
                return Some(key);
            }
        }
    }
}
