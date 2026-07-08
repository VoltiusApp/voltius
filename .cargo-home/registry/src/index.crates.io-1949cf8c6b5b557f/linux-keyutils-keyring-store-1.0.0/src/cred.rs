use super::error::KeyStoreError;
use keyring_core::Error::NoStorageAccess;
use keyring_core::api::CredentialApi;
use keyring_core::{Credential, Error};
use linux_keyutils::{KeyRing, KeyRingIdentifier};
use std::sync::Arc;

/// Representation of a keyutils credential.
///
/// Since the CredentialBuilderApi::build method does not provide
/// an initial secret, and it is impossible to have 0-length keys,
/// this representation holds a linux_keyutils::KeyRing instead
/// of a linux_keyutils::Key.
///
/// The added benefit of this approach
/// is that any call to get_password before set_password is done
/// will result in a proper error as the key does not exist until
/// set_password is called.
#[derive(Debug, Clone)]
pub struct Cred {
    /// Host session keyring
    pub session: KeyRing,
    /// Host persistent keyring
    pub persistent: Option<KeyRing>,
    /// Description of the key entry
    pub description: String,
    /// Specifiers for the entry, if any
    pub specifiers: Option<(String, String)>,
}

impl CredentialApi for Cred {
    /// See the keyring-core API docs.
    ///
    /// This will overwrite the entry if it already exists since
    /// it's using `add_key` under the hood.
    ///
    /// Returns an [Invalid](Error::Invalid) error if the password
    /// is empty, because keyutils keys cannot have empty values.
    fn set_secret(&self, secret: &[u8]) -> keyring_core::error::Result<()> {
        if secret.is_empty() {
            return Err(Error::Invalid(
                "secret".to_string(),
                "cannot be empty".to_string(),
            ));
        }
        self.set(secret)?;
        Ok(())
    }

    /// See the keyring-core API docs.
    ///
    /// This requires a call to `Key::read`.
    fn get_secret(&self) -> keyring_core::error::Result<Vec<u8>> {
        let buffer = self.get()?;
        Ok(buffer)
    }

    /// See the keyring-core API docs.
    ///
    /// Under the hood this uses `Key::invalidate` to immediately
    /// invalidate the key and prevent any further successful
    /// searches.
    ///
    /// Note that the keyutils implementation uses caching,
    /// and the caches take some time to clear,
    /// so get_password may find a key that has been invalidated
    /// if it's called within milliseconds of the invalidation
    /// in *the same process* that deleted the key.
    fn delete_credential(&self) -> keyring_core::error::Result<()> {
        self.remove()?;
        Ok(())
    }

    /// See the keyring-core API docs.
    ///
    /// Since this store has no ambiguity, entries are wrappers.
    fn get_credential(&self) -> keyring_core::Result<Option<Arc<Credential>>> {
        self.session
            .search(&self.description)
            .map_err(KeyStoreError::from)
            .map_err(keyring_core::Error::from)?;
        Ok(None)
    }

    /// See the keyring-core API docs.
    ///
    /// Specifiers are remembered at creation time if the description was not custom.
    fn get_specifiers(&self) -> Option<(String, String)> {
        self.specifiers.clone()
    }

    /// See the keyring-core API docs.
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    /// See the keyring-core API docs.
    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}

impl Cred {
    /// Create the platform credential for a Keyutils entry.
    ///
    /// An explicit target string is interpreted as the description to use for the entry.
    /// If none is provided, then we concatenate the user and service in the string
    /// `{delimiters[0]}{user}{delimiters[1]}{service}{delimiters[2]}`.
    pub fn build_from_specifiers(
        target: Option<&str>,
        delimiters: &[String; 3],
        service_no_dividers: bool,
        service: &str,
        user: &str,
    ) -> keyring_core::error::Result<Self> {
        // Construct the description with a URI-style description
        let (description, specifiers) = match target {
            Some(value) => (value.to_string(), None),
            None => {
                if service_no_dividers && service.contains(delimiters[1].as_str()) {
                    return Err(Error::Invalid(
                        "service".to_string(),
                        "cannot contain delimiter".to_string(),
                    ));
                }
                (
                    format!(
                        "{}{user}{}{service}{}",
                        delimiters[0], delimiters[1], delimiters[2]
                    ),
                    Some((service.to_string(), user.to_string())),
                )
            }
        };
        if description.is_empty() {
            return Err(Error::Invalid(
                "description".to_string(),
                "cannot be empty".to_string(),
            ));
        }

        // Get the session keyring
        let session = KeyRing::from_special_id(KeyRingIdentifier::Session, false)
            .map_err(|e| NoStorageAccess(e.into()))?;

        // Link the persistent keyring to the session
        let persistent = KeyRing::get_persistent(KeyRingIdentifier::Session).ok();

        Ok(Self {
            session,
            persistent,
            description,
            specifiers,
        })
    }

    /// Internal method to retrieve the underlying secret
    ///
    /// Will search for and re-link the existing key to the session and
    /// persistent keyrings to ensure the key doesn't time out.
    fn get(&self) -> Result<Vec<u8>, KeyStoreError> {
        // Verify that the key exists and is valid
        let key = self.session.search(&self.description)?;

        // Directly re-link to the session keyring
        // If a logout occurred, it will only be linked to the
        // persistent keyring and needs to be added again.
        self.session.link_key(key)?;

        // Directly re-link to the persistent keyring
        // If it expired, it will only be linked to the
        // session keyring and needs to be added again.
        if let Some(keyring) = self.persistent {
            keyring.link_key(key)?;
        }

        // Read in the key (making sure we have enough room)
        let data = key.read_to_vec()?;
        Ok(data)
    }

    /// Internal method to set the underlying secret
    ///
    /// Will add the key directly to the session and link it to the
    /// persistent keyring when available.
    fn set<T: AsRef<[u8]>>(&self, secret: T) -> Result<(), KeyStoreError> {
        // Add to the session keyring
        let key = self.session.add_key(&self.description, &secret)?;

        // Directly link to the persistent keyring as well
        if let Some(keyring) = self.persistent {
            keyring.link_key(key).map_err(KeyStoreError)?;
        }
        Ok(())
    }

    /// Internal method to remove the underlying secret
    ///
    /// Performs a search and invalidates the key when found.
    fn remove(&self) -> Result<(), KeyStoreError> {
        // Verify that the key exists and is valid
        let key = self.session.search(&self.description)?;

        // Invalidate the key immediately
        key.invalidate()?;
        Ok(())
    }
}
