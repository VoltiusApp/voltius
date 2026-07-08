use keyring_core::error::Error as KeyRingError;
use linux_keyutils::KeyError as KeyUtilsError;
use std::ops::Deref;

/// Internal new type to convert linux_keyutils::KeyError to
/// keyring_core::error::Error implicitly.
pub(crate) struct KeyStoreError(pub(crate) KeyUtilsError);

impl Deref for KeyStoreError {
    type Target = KeyUtilsError;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl From<KeyUtilsError> for KeyStoreError {
    fn from(err: KeyUtilsError) -> KeyStoreError {
        KeyStoreError(err)
    }
}

impl From<KeyStoreError> for KeyRingError {
    fn from(err: KeyStoreError) -> KeyRingError {
        match err.0 {
            // Experimentation has shown that the keyutils implementation can return a lot of
            // different errors that all mean "no such key", depending on where in the invalidation
            // processing the [get_password](KeyutilsCredential::get_password) call is made.
            KeyUtilsError::KeyDoesNotExist
            | KeyUtilsError::KeyRevoked
            | KeyUtilsError::KeyExpired => KeyRingError::NoEntry,
            KeyUtilsError::AccessDenied => KeyRingError::NoStorageAccess(err.0.into()),
            KeyUtilsError::InvalidDescription => KeyRingError::Invalid(
                "description".to_string(),
                "rejected by the platform".to_string(),
            ),
            KeyUtilsError::InvalidArguments => KeyRingError::Invalid(
                "password".to_string(),
                "rejected by the platform".to_string(),
            ),
            other => KeyRingError::PlatformFailure(other.into()),
        }
    }
}
