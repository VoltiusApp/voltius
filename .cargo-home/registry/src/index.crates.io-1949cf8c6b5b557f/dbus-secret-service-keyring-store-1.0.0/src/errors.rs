//!
//! Error utilities
//!

use dbus_secret_service::Error as ServiceError;

use keyring_core::error::Error;

/// Map underlying secret-service errors to keyring errors with
/// appropriate annotation.
pub fn decode_error(err: ServiceError) -> Error {
    match err {
        ServiceError::Locked => no_access(err),
        ServiceError::NoResult => no_access(err),
        ServiceError::Prompt => no_access(err),
        _ => platform_failure(err),
    }
}

pub fn empty_target() -> Error {
    Error::Invalid("target".to_string(), "cannot be empty".to_string())
}

pub fn platform_failure(err: ServiceError) -> Error {
    Error::PlatformFailure(wrap(err))
}

fn no_access(err: ServiceError) -> Error {
    Error::NoStorageAccess(wrap(err))
}

fn wrap(err: ServiceError) -> Box<dyn std::error::Error + Send + Sync> {
    Box::new(err)
}
