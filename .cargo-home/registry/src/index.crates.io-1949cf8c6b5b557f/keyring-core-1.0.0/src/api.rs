/*!

# Platform-independent secure storage model

This module defines a plug and play model for credential stores.
The model comprises two traits: [CredentialStoreApi] for
store-level operations
and [CredentialApi] for
entry-level operations.  These traits must be implemented
in a thread-safe way, a requirement captured in the [CredentialStore] and
[Credential] types that wrap them.
 */
use std::any::Any;
use std::collections::HashMap;
use std::sync::Arc;

use super::{Entry, Error, Result};

/// The API that [credentials](Credential) implement.
pub trait CredentialApi {
    /// Set the entry's protected data to be the given string.
    ///
    /// This method has a default implementation in terms of
    /// [set_secret](CredentialApi::set_secret), which see.
    fn set_password(&self, password: &str) -> Result<()> {
        self.set_secret(password.as_bytes())
    }

    /// Set the underlying credential's protected data to be the given byte array.
    ///
    /// - If the password cannot be stored in a credential,
    ///   return an [Invalid](Error::Invalid) error.
    /// - If the entry is a specifier, and there is no matching credential,
    ///   create a matching credential and save the data in it.
    /// - If the entry is a specifier, and there is more than one matching credential,
    ///   return an [Ambiguous](Error::Ambiguous) error.
    /// - If the entry is a wrapper, and the wrapped credential has been deleted,
    ///   either recreate the wrapped credential and set its value or
    ///   return a [NoEntry](Error::NoEntry) error.
    /// - Otherwise, set the value of the single, matching credential.
    ///
    /// Note: If an entry is both a specifier and a wrapper, it's up to the store
    /// whether to recreate a deleted credential or to fail with a NoEntry error.
    fn set_secret(&self, secret: &[u8]) -> Result<()>;

    /// Retrieve the protected data as a UTF-8 string from the underlying credential.
    ///
    /// This method has a default implementation in terms of
    /// [get_secret](CredentialApi::get_secret), which see.
    /// If the data in the credential is not valid UTF-8, the default implementation
    /// returns a [BadEncoding](Error::BadEncoding) error containing the data.
    fn get_password(&self) -> Result<String> {
        let secret = self.get_secret()?;
        super::error::decode_password(secret)
    }

    /// Retrieve the protected data as a byte array from the underlying credential.
    ///
    /// - If the entry is a specifier, and there is no matching credential,
    ///   return a [NoEntry](Error::NoEntry) error.
    /// - If the entry is a specifier, and there is more than one matching credential,
    ///   return an [Ambiguous](Error::Ambiguous) error.
    /// - If the entry is a wrapper, and the wrapped credential has been deleted,
    ///   return a [NoEntry](Error::NoEntry) error.
    /// - Otherwise, return the value of the single, matching credential.
    fn get_secret(&self) -> Result<Vec<u8>>;

    /// Return any store-specific decorations on this entry's credential.
    ///
    /// The expected error and success cases are the same as with
    /// [get_secret](CredentialApi::get_secret), which see.
    ///
    /// For convenience, a default implementation of this method is
    /// provided which doesn't return any attributes. Credential
    /// store implementations which support attributes should
    /// override this method.
    fn get_attributes(&self) -> Result<HashMap<String, String>> {
        // this should err in the same cases as get_secret, so first call that for effect
        self.get_secret()?;
        // if we got this far, return success with no attributes
        Ok(HashMap::new())
    }

    /// Update the secure store attributes on this entry's credential.
    ///
    /// If the user supplies any attributes that cannot be updated,
    /// return an appropriate [Invalid](Error::Invalid) error.
    ///
    /// Other expected error and success cases are the same as with
    /// [get_secret](CredentialApi::get_secret), which see.
    ///
    /// For convenience, a default implementation of this method is
    /// provided which returns a [NotSupportedByStore](Error::NotSupportedByStore) error.
    fn update_attributes(&self, _: &HashMap<&str, &str>) -> Result<()> {
        Err(Error::NotSupportedByStore(String::from(
            "This store does not allow attribute updates",
        )))
    }

    /// Delete the underlying credential.
    ///
    /// If the underlying credential doesn't exist, return
    /// a [NoEntry](Error::NoEntry) error.
    ///
    /// If there is more than one matching credential,
    /// return an [Ambiguous](Error::Ambiguous) error.
    fn delete_credential(&self) -> Result<()>;

    /// Return a wrapper for the underlying credential.
    ///
    /// If `self` is already a wrapper, you can return `None`
    /// to give `self` back to the client.
    /// Or you can return a new wrapper
    /// for the same underlying credential. See the
    /// [keyring-core wiki page](https://github.com/open-source-cooperative/keyring-rs/wiki/Keyring-Core#specifier-credentials-vs-wrapper-credentials)
    /// for why the `None` option is available.
    ///
    /// If the underlying credential doesn't exist, return
    /// a [NoEntry](Error::NoEntry) error.
    ///
    /// If there is more than one matching credential,
    /// return an [Ambiguous](Error::Ambiguous) error.
    fn get_credential(&self) -> Result<Option<Arc<Credential>>>;

    /// Return the `<service, user>` pair for this credential, if any.
    fn get_specifiers(&self) -> Option<(String, String)>;

    /// Return the inner credential object cast to [Any].
    ///
    /// This call is used to expose the Debug trait for credentials.
    fn as_any(&self) -> &dyn Any;

    /// The Debug trait call for the object.
    ///
    /// This is used to implement the Debug trait on this type; it
    /// allows generic code to provide debug printing as provided by
    /// the underlying concrete object.
    ///
    /// We provide a (no-op) default implementation of this method.
    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self.as_any(), f)
    }
}

/// A thread-safe implementation of the [Credential API](CredentialApi).
pub type Credential = dyn CredentialApi + Send + Sync;

impl std::fmt::Debug for Credential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.debug_fmt(f)
    }
}

/// A descriptor for the lifetime of stored credentials, returned from
/// a credential store's [persistence](CredentialStoreApi::persistence) call.
///
/// This enum may change even in minor and patch versions of the library, so it's
/// marked as non-exhaustive.
#[non_exhaustive]
pub enum CredentialPersistence {
    /// Credential storage is in the entry, so storage vanishes when the entry is dropped.
    EntryOnly,
    /// Credential storage is in process memory,
    /// so storage vanishes when the process terminates
    ProcessOnly,
    /// Credential storage is in user-space memory, so storage vanishes when the user logs out
    UntilLogout,
    /// Credentials stored in kernel-space memory, so storage vanishes when the machine reboots
    UntilReboot,
    /// Credentials stored on disk, so storage vanishes when the credential is deleted
    UntilDelete,
    /// Placeholder for cases not (yet) handled here
    Unspecified,
}

/// The API that [credential stores](CredentialStore) implement.
pub trait CredentialStoreApi {
    /// The name of the "vendor" that provides this store.
    ///
    /// This allows clients to conditionalize their code for specific vendors.
    /// This string should not vary with versions of the store. It's recommended
    /// that it include the crate URL for the module provider.
    fn vendor(&self) -> String;

    /// The ID of this credential store instance.
    ///
    /// IDs need not be unique across vendors or processes, but they
    /// serve as instance IDs within a process.  If two credential store
    /// instances in a process have the same vendor and id,
    /// then they are the same instance.
    ///
    /// It's recommended that this include the version of the provider.
    fn id(&self) -> String;

    /// Create an entry specified by the given service and user,
    /// perhaps with additional creation-time modifiers.
    ///
    /// The credential returned from this call must be a specifier,
    /// meaning that it can be used to create a credential later
    /// even if a matching credential existed in the store .
    ///
    /// This typically has no effect on the content of the underlying store.
    /// A credential need not be persisted until its password is set.
    fn build(
        &self,
        service: &str,
        user: &str,
        modifiers: Option<&HashMap<&str, &str>>,
    ) -> Result<Entry>;

    /// Search for credentials that match the given spec.
    ///
    /// Returns a list of the matching credentials.
    ///
    /// Should return an [Invalid](Error::Invalid) error if the spec is bad.
    ///
    /// The default implementation returns a
    /// [NotSupportedByStore](Error::NotSupportedByStore) error; that is,
    /// credential stores need not provide support for search.
    fn search(&self, _spec: &HashMap<&str, &str>) -> Result<Vec<Entry>> {
        let msg = "This store does not provide search capabilities";
        Err(Error::NotSupportedByStore(msg.to_string()))
    }

    /// Return the inner store object cast to [Any].
    ///
    /// This call is used to expose the Debug trait for stores.
    fn as_any(&self) -> &dyn Any;

    /// The lifetime of credentials produced by this builder.
    ///
    /// A default implementation is provided for backward compatibility,
    /// since this API was added in a minor release.  The default assumes
    /// that keystores use disk-based credential storage.
    fn persistence(&self) -> CredentialPersistence {
        CredentialPersistence::UntilDelete
    }

    /// The Debug trait call for the object.
    ///
    /// This is used to implement the Debug trait on this type; it
    /// allows generic code to provide debug printing as provided by
    /// the underlying concrete object.
    ///
    /// We provide a (no-op) default implementation of this method.
    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self.as_any(), f)
    }
}

impl std::fmt::Debug for CredentialStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.debug_fmt(f)
    }
}

/// A thread-safe implementation of the [CredentialBuilder API](CredentialStoreApi).
pub type CredentialStore = dyn CredentialStoreApi + Send + Sync;
