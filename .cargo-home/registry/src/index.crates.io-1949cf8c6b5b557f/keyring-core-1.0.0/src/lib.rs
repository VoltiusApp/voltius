#![cfg_attr(docsrs, feature(doc_cfg))]
/*!

# Keyring-core

This crate provides a cross-platform library that supports storage and retrieval
of passwords (or other secrets) in a variety of secure credential stores.
Please see
[this document](https://github.com/open-source-cooperative/keyring-rs/wiki/Keyring)
for an introduction to the keyring ecosystem and
[this document](https://github.com/open-source-cooperative/keyring-rs/wiki/Keyring-Core)
for a comprehensive treatment of this crate's APIs.

This crate provides two cross-platform credential stores. These
are provided to support client testing and as a guide for developers who
would like to build keyring-compatible credential store modules. The
stores in this crate are explicitly _not_ warranted to be either secure or robust.
See the [mock] and [sample] modules for details. (Note: the [sample]
module is only built if the `sample` feature is specified.)

## Thread Safety

While this crate's code is thread-safe,
and requires credential store objects
to be both Send and Sync, the underlying credential
stores may not handle access to a single credential
from different threads reliably.
See the documentation of each credential store for details.
 */

use log::debug;
use std::collections::HashMap;
use std::sync::Arc;

pub mod api;
pub mod attributes;
pub mod error;

pub mod mock;

#[cfg(feature = "sample")]
pub mod sample;

pub use api::{Credential, CredentialPersistence, CredentialStore};
pub use error::{Error, Result};

#[derive(Default, Debug)]
struct DefaultStore {
    inner: Option<Arc<CredentialStore>>,
}

static DEFAULT_STORE: std::sync::RwLock<DefaultStore> =
    std::sync::RwLock::new(DefaultStore { inner: None });

/// Set the credential store used by default to create entries.
///
/// This is meant for use by clients who use one credential store.
/// If you are using multiple credential stores and want
/// precise control over which credential is in which store,
/// you may prefer to have your store build entries directly.
///
/// This will block waiting for all other threads currently creating entries
/// to complete what they are doing. It's really meant to be called
/// at startup before creating any entries.
pub fn set_default_store(new: Arc<CredentialStore>) {
    debug!("setting the default credential store to {new:?}");
    let mut guard = DEFAULT_STORE
        .write()
        .expect("Poisoned RwLock in keyring_core::set_default_store: please report a bug!");
    guard.inner = Some(new);
}

/// Get the default credential store.
pub fn get_default_store() -> Option<Arc<CredentialStore>> {
    debug!("getting the default credential store");
    let guard = DEFAULT_STORE
        .read()
        .expect("Poisoned RwLock in keyring_core::get_default_store: please report a bug!");
    guard.inner.clone()
}

/// Release the default credential store.
///
/// This returns the old value for the default credential store
/// and forgets what it was. Since the default credential store
/// is kept in a static variable, not releasing it will cause
/// your credential store never to be released, which may have
/// unintended side effects.
pub fn unset_default_store() -> Option<Arc<CredentialStore>> {
    debug!("unsetting the default credential store");
    let mut guard = DEFAULT_STORE
        .write()
        .expect("Poisoned RwLock in keyring_core::unset_default_store: please report a bug!");
    guard.inner.take()
}

fn build_default_credential(
    service: &str,
    user: &str,
    attrs: Option<&HashMap<&str, &str>>,
) -> Result<Entry> {
    let guard = DEFAULT_STORE
        .read()
        .expect("Poisoned RwLock in keyring-core::build_default_credential: please report a bug!");
    match guard.inner.as_ref() {
        Some(store) => store.build(service, user, attrs),
        None => Err(Error::NoDefaultStore),
    }
}

/// A named entry in a credential store.
#[derive(Debug)]
pub struct Entry {
    inner: Arc<Credential>,
}

impl Entry {
    /// Create an entry for the given `service` and `user`.
    ///
    /// The default credential builder is used.
    ///
    /// # Errors
    ///
    /// Returns an [Invalid][Error::Invalid] error
    /// if the `service` or `user` values are not
    /// acceptable to the default credential store.
    ///
    /// Returns a [NoDefaultStore][Error::NoDefaultStore] error
    /// if the default credential store has not been set.
    pub fn new(service: &str, user: &str) -> Result<Entry> {
        debug!("creating entry with service {service}, user {user}");
        let entry = build_default_credential(service, user, None)?;
        debug!("created entry {:?}", entry.inner);
        Ok(entry)
    }

    /// Create an entry for the given `service` and `user`, passing store-specific modifiers.
    ///
    /// The default credential builder is used.
    ///
    /// See the documentation for each credential store to understand what
    /// modifiers may be specified for that store.
    ///
    /// # Errors
    ///
    /// Returns an [Invalid][Error::Invalid] error
    /// if the `service`, `user`, or `modifier` pairs are not
    /// acceptable to the default credential store.
    ///
    /// Returns a [NoDefaultStore][Error::NoDefaultStore] error
    /// if the default credential store has not been set.
    pub fn new_with_modifiers(
        service: &str,
        user: &str,
        modifiers: &HashMap<&str, &str>,
    ) -> Result<Entry> {
        debug!("creating entry with service {service}, user {user}, and mods {modifiers:?}");
        let entry = build_default_credential(service, user, Some(modifiers))?;
        debug!("created entry {:?}", entry.inner);
        Ok(entry)
    }

    /// Create an entry that wraps a pre-existing credential. The credential can
    /// be from any credential store.
    pub fn new_with_credential(credential: Arc<Credential>) -> Entry {
        debug!("create entry wrapping {credential:?}");
        Entry { inner: credential }
    }

    /// Search for credentials, returning entries that wrap any found.
    ///
    /// The default credential store is searched.
    /// See the documentation of each credential store for how searches are specified.
    ///
    /// # Errors
    ///
    /// Returns an [Invalid][Error::Invalid] error
    /// if the `spec` value is not acceptable to the default credential store.
    ///
    /// Returns a [NoDefaultStore][Error::NoDefaultStore] error
    /// if the default credential store has not been set.
    pub fn search(spec: &HashMap<&str, &str>) -> Result<Vec<Entry>> {
        debug!("searching for {spec:?}");
        let guard = DEFAULT_STORE.read().expect(
            "Poisoned RwLock in keyring-core::search_for_credentials: please report a bug!",
        );
        match guard.inner.as_ref() {
            Some(store) => store.search(spec),
            None => Err(Error::NoDefaultStore),
        }
    }

    /// Set the password for this entry.
    ///
    /// If a credential for this entry already exists in the store,
    /// this will update its password. Otherwise, a new credential
    /// will be created to store the password.
    ///
    /// # Errors
    ///
    /// If this entry is a specifier,
    /// and there is more than one matching credential in the store,
    /// returns an [Ambiguous](Error::Ambiguous) error.
    ///
    /// If this entry is a wrapper, and the
    /// underlying credential has been deleted,
    /// may return a [NoEntry](Error::NoEntry) error.
    ///
    /// If a credential cannot store the given password (not
    /// all stores support empty passwords, and some have length limits),
    /// then an [Invalid](Error::Invalid) error is returned.
    pub fn set_password(&self, password: &str) -> Result<()> {
        debug!("set password for entry {:?}", self.inner);
        self.inner.set_password(password)
    }

    /// Set the secret for this entry.
    ///
    /// If a credential for this entry already exists in the store,
    /// this will update its secret. Otherwise, a new credential
    /// will be created to store the secret.
    ///
    /// # Errors
    ///
    /// If this entry is a specifier,
    /// and there is more than one matching credential in the store,
    /// returns an [Ambiguous](Error::Ambiguous) error.
    ///
    /// If this entry is a wrapper, and the
    /// underlying credential has been deleted,
    /// may return a [NoEntry](Error::NoEntry) error.
    ///
    /// If a credential cannot store the given password (not
    /// all stores support empty passwords, and some have length limits),
    /// then an [Invalid](Error::Invalid) error is returned.
    pub fn set_secret(&self, secret: &[u8]) -> Result<()> {
        debug!("set secret for entry {:?}", self.inner);
        self.inner.set_secret(secret)
    }

    /// Retrieve the password saved for this entry.
    ///
    /// # Errors
    ///
    /// If this entry is a specifier,
    /// and there is no matching credential in the store,
    /// returns a [NoEntry](Error::NoEntry) error.
    ///
    /// If this entry is a specifier,
    /// and there is more than one matching credential in the store,
    /// returns an [Ambiguous](Error::Ambiguous) error.
    ///
    /// If this entry is a wrapper,
    /// the underlying credential has been deleted,
    /// and the store cannot recreate it,
    /// returns a [NoEntry](Error::NoEntry) error.
    ///
    /// Will return a [BadEncoding](Error::BadEncoding) error
    /// containing the data as a byte array if the password is
    /// not a valid UTF-8 string.
    pub fn get_password(&self) -> Result<String> {
        debug!("get password from entry {:?}", self.inner);
        self.inner.get_password()
    }

    /// Retrieve the secret saved for this entry.
    ///
    /// # Errors
    ///
    /// If this entry is a specifier,
    /// and there is no matching credential in the store,
    /// returns a [NoEntry](Error::NoEntry) error.
    ///
    /// If this entry is a specifier,
    /// and there is more than one matching credential in the store,
    /// returns an [Ambiguous](Error::Ambiguous) error.
    ///
    /// If this entry is a wrapper,
    /// and the underlying credential has been deleted,
    /// returns a [NoEntry](Error::NoEntry) error.
    pub fn get_secret(&self) -> Result<Vec<u8>> {
        debug!("get secret from entry {:?}", self.inner);
        self.inner.get_secret()
    }

    /// Get the store-specific decorations on this entry's credential.
    ///
    /// See the documentation for each credential store
    /// for details of what decorations are supported
    /// and how they are returned.
    ///
    /// # Errors
    ///
    /// If this entry is a specifier,
    /// and there is no matching credential in the store,
    /// returns a [NoEntry](Error::NoEntry) error.
    ///
    /// If this entry is a specifier,
    /// and there is more than one matching credential in the store,
    /// returns an [Ambiguous](Error::Ambiguous) error.
    ///
    /// If this entry is a wrapper,
    /// and the underlying credential has been deleted,
    /// returns a [NoEntry](Error::NoEntry) error.
    pub fn get_attributes(&self) -> Result<HashMap<String, String>> {
        debug!("get attributes from entry {:?}", self.inner);
        self.inner.get_attributes()
    }

    /// Update the store-specific decorations on this entry's credential.
    ///
    /// See the documentation for each credential store
    /// for details of what decorations can be updated
    /// and how updates are expressed.
    ///
    /// # Errors
    ///
    /// If one of the attributes supplied is not valid for the underlying store,
    /// returns an [Invalid](Error::Invalid) error.
    ///
    /// If this entry is a specifier,
    /// and there is no matching credential in the store,
    /// returns a [NoEntry](Error::NoEntry) error.
    ///
    /// If this entry is a specifier,
    /// and there is more than one matching credential in the store,
    /// returns an [Ambiguous](Error::Ambiguous) error.
    ///
    /// If this entry is a wrapper,
    /// and the underlying credential has been deleted,
    /// returns a [NoEntry](Error::NoEntry) error.
    pub fn update_attributes(&self, attributes: &HashMap<&str, &str>) -> Result<()> {
        debug!(
            "update attributes for entry {:?} from map {attributes:?}",
            self.inner
        );
        self.inner.update_attributes(attributes)
    }

    /// Delete the matching credential for this entry.
    ///
    /// This call does _not_ affect the lifetime of the [Entry]
    /// structure, only that of the underlying credential.
    ///
    /// # Errors
    ///
    /// If this entry is a specifier,
    /// and there is no matching credential in the store,
    /// returns a [NoEntry](Error::NoEntry) error.
    ///
    /// If this entry is a specifier,
    /// and there is more than one matching credential in the store,
    /// returns an [Ambiguous](Error::Ambiguous) error.
    ///
    /// If this entry is a wrapper,
    /// and the underlying credential has been deleted,
    /// returns a [NoEntry](Error::NoEntry) error.
    pub fn delete_credential(&self) -> Result<()> {
        debug!("delete entry {:?}", self.inner);
        self.inner.delete_credential()
    }

    /// Get a wrapper for the currently matching credential.
    ///
    /// # Errors
    ///
    /// If this entry is a specifier,
    /// and there is no matching credential in the store,
    /// returns a [NoEntry](Error::NoEntry) error.
    ///
    /// If this entry is a specifier,
    /// and there is more than one matching credential in the store,
    /// returns an [Ambiguous](Error::Ambiguous) error.
    ///
    /// If this entry is a wrapper,
    /// and the underlying credential has been deleted,
    /// returns a [NoEntry](Error::NoEntry) error.
    pub fn get_credential(&self) -> Result<Entry> {
        debug!("get credential for entry {:?}", self.inner);
        match self.inner.get_credential() {
            Ok(Some(inner)) => Ok(Entry { inner }),
            Ok(None) => Ok(Entry {
                inner: self.inner.clone(),
            }),
            Err(e) => Err(e),
        }
    }

    /// Get the `<service, user>` pair for this entry, if any.
    pub fn get_specifiers(&self) -> Option<(String, String)> {
        self.inner.get_specifiers()
    }

    /// Return a reference to the inner store-specific object in this entry.
    ///
    /// The reference is of the [Any](std::any::Any) type, so it can be
    /// downgraded to a concrete object for the containing store.
    pub fn as_any(&self) -> &dyn std::any::Any {
        self.inner.as_any()
    }
}

#[cfg(doctest)]
doc_comment::doctest!("../README.md", readme);
