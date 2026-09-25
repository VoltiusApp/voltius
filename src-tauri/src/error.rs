//! Unified application error type.
//!
//! `AppError` is the single error type that backend logic and Tauri commands
//! converge on. It carries rich typed variants internally (so `?` can convert
//! `io::Error`, `serde_json::Error`, …). An error without an [`ErrorCode`]
//! **serializes as a plain string** — the exact same wire shape Tauri commands
//! have always returned with `Result<T, String>`. One with a code serializes as
//! `{ code, message, params? }` so the frontend can translate it; its message is
//! the same English text the bare string would have been, and the frontend turns
//! the object back into an `Error` whose `String()` is that message.
//!
//! Migration is intentionally module-by-module; see the Phase 1 refactor plan.
//! A code only reaches the frontend through commands returning `AppError` —
//! `?` into a `Result<T, String>` keeps the message and drops the code.

use std::collections::BTreeMap;
use std::fmt::Display;
use std::io::ErrorKind;
use thiserror::Error;

/// Declares [`ErrorCode`] and, for the translation-coverage test, every variant.
macro_rules! error_codes {
    ($($variant:ident),* $(,)?) => {
        /// Why an operation failed, as a stable key the frontend translates
        /// (`errors.<code>` in src/i18n/locales/*/errors.json). Mirrored by
        /// `BackendErrorCode` in src/services/backendErrors.ts.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
        #[serde(rename_all = "kebab-case")]
        pub enum ErrorCode {
            $($variant),*
        }

        #[cfg(test)]
        impl ErrorCode {
            pub const ALL: &[ErrorCode] = &[$(ErrorCode::$variant),*];
        }
    };
}

error_codes! {
    // Filesystems (local and remote) and sockets.
    PermissionDenied,
    NotFound,
    AlreadyExists,
    StorageFull,
    ReadOnlyFilesystem,
    ConnectionRefused,
    HostUnreachable,
    TimedOut,
    ConnectionLost,
    // Port forwarding. Params: `port` and `attempts` for PortInUse.
    PortInUse,
    RemoteForwardDenied,
    // SSH authentication. Params: `prompt` / `methods` / `seconds`.
    SshKeyRejected,
    SshPasswordRejected,
    SshPasswordExpired,
    SshPromptUnanswerable,
    SshNoUsableAuthMethod,
    SshAuthTimeout,
    // Vault access. Shares its first two codes with the frontend's own VaultError.
    // Params: `role` for VaultRoleReadOnly.
    VaultLocked,
    VaultUnreadable,
    VaultSignInRequired,
    VaultReadOnly,
    VaultRoleReadOnly,
    VaultPermissionsUnavailable,
    VaultPermissionsCorrupted,
}

/// A lower-level failure whose cause may have an [`ErrorCode`]. The one place
/// each library's error kinds are mapped; sites wrap them with [`AppError::caused`].
pub trait Classify {
    fn error_code(&self) -> Option<ErrorCode>;
}

impl Classify for ErrorKind {
    fn error_code(&self) -> Option<ErrorCode> {
        use ErrorCode as C;
        Some(match self {
            ErrorKind::PermissionDenied => C::PermissionDenied,
            ErrorKind::NotFound => C::NotFound,
            ErrorKind::AlreadyExists => C::AlreadyExists,
            ErrorKind::StorageFull | ErrorKind::QuotaExceeded => C::StorageFull,
            ErrorKind::ReadOnlyFilesystem => C::ReadOnlyFilesystem,
            ErrorKind::ConnectionRefused => C::ConnectionRefused,
            ErrorKind::HostUnreachable | ErrorKind::NetworkUnreachable | ErrorKind::NetworkDown => {
                C::HostUnreachable
            }
            ErrorKind::TimedOut => C::TimedOut,
            ErrorKind::ConnectionReset
            | ErrorKind::ConnectionAborted
            | ErrorKind::BrokenPipe
            | ErrorKind::UnexpectedEof => C::ConnectionLost,
            _ => return None,
        })
    }
}

impl Classify for std::io::Error {
    fn error_code(&self) -> Option<ErrorCode> {
        self.kind().error_code()
    }
}

impl Classify for russh::Error {
    fn error_code(&self) -> Option<ErrorCode> {
        match self {
            russh::Error::IO(io) => io.error_code(),
            russh::Error::ConnectionTimeout | russh::Error::Elapsed(_) => Some(ErrorCode::TimedOut),
            russh::Error::HUP | russh::Error::Disconnect | russh::Error::KeepaliveTimeout => {
                Some(ErrorCode::ConnectionLost)
            }
            _ => None,
        }
    }
}

/// The server's status, or the channel under the SFTP session.
impl Classify for russh_sftp::client::error::Error {
    fn error_code(&self) -> Option<ErrorCode> {
        use russh_sftp::client::error::Error as Sftp;
        use russh_sftp::protocol::StatusCode;
        match self {
            Sftp::Status(s) => match s.status_code {
                StatusCode::NoSuchFile => Some(ErrorCode::NotFound),
                StatusCode::PermissionDenied => Some(ErrorCode::PermissionDenied),
                StatusCode::NoConnection | StatusCode::ConnectionLost => {
                    Some(ErrorCode::ConnectionLost)
                }
                _ => None,
            },
            Sftp::Timeout => Some(ErrorCode::TimedOut),
            Sftp::IO(_) => Some(ErrorCode::ConnectionLost),
            _ => None,
        }
    }
}

#[derive(Debug, Error)]
pub enum AppError {
    #[error("{0}")]
    Io(#[from] std::io::Error),

    #[error("{0}")]
    Json(#[from] serde_json::Error),

    /// Catch-all for string-literal / formatted messages (e.g. "store is locked").
    /// Preserves the exact text callers used before the unified type existed.
    #[error("{0}")]
    Msg(String),

    /// A failure the frontend can name in the user's language. `message` is the
    /// English text logs and not-yet-migrated string callers see.
    #[error("{message}")]
    Coded {
        code: ErrorCode,
        message: String,
        params: BTreeMap<&'static str, String>,
    },
}

impl AppError {
    pub fn coded(code: ErrorCode, message: impl Into<String>) -> Self {
        AppError::Coded {
            code,
            message: message.into(),
            params: BTreeMap::new(),
        }
    }

    /// Adds a value the translation interpolates (`{{key}}`). No-op on an
    /// uncoded error, which has no translation to fill.
    pub fn with_param(mut self, key: &'static str, value: impl ToString) -> Self {
        if let AppError::Coded { params, .. } = &mut self {
            params.insert(key, value.to_string());
        }
        self
    }

    /// `"{context}: {cause}"` — the text such sites always built — coded after
    /// the cause when it has one.
    pub fn caused(context: impl Display, cause: &(impl Classify + Display)) -> Self {
        Self::maybe_coded(cause.error_code(), format!("{context}: {cause}"))
    }

    /// `cause`'s own text, coded after it when it has a code.
    pub fn classified(cause: &(impl Classify + Display)) -> Self {
        Self::maybe_coded(cause.error_code(), cause.to_string())
    }

    fn maybe_coded(code: Option<ErrorCode>, message: String) -> Self {
        match code {
            Some(code) => AppError::coded(code, message),
            None => AppError::Msg(message),
        }
    }

    pub fn code(&self) -> Option<ErrorCode> {
        match self {
            AppError::Coded { code, .. } => Some(*code),
            AppError::Io(e) => e.error_code(),
            AppError::Json(_) | AppError::Msg(_) => None,
        }
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Msg(s)
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Msg(s.to_string())
    }
}

/// Lets not-yet-migrated `Result<T, String>` callers use `?` on a
/// `Result<T, AppError>` transparently during the incremental rollout.
impl From<AppError> for String {
    fn from(e: AppError) -> Self {
        e.to_string()
    }
}

/// A bare string for an uncoded error, so Tauri's IPC layer hands the frontend
/// the same value it always received from `Result<T, String>`; otherwise
/// `{ code, message, params? }`.
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        use serde::ser::SerializeMap;
        let Some(code) = self.code() else {
            return serializer.serialize_str(&self.to_string());
        };
        let mut map = serializer.serialize_map(None)?;
        map.serialize_entry("code", &code)?;
        map.serialize_entry("message", &self.to_string())?;
        if let AppError::Coded { params, .. } = self {
            if !params.is_empty() {
                map.serialize_entry("params", params)?;
            }
        }
        map.end()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_a_bare_json_string() {
        let err = AppError::from(std::io::Error::other("boom"));
        let json = serde_json::to_string(&err).unwrap();
        // A JSON string, not an object/tagged-enum — this is the IPC contract.
        assert!(json.starts_with('"') && json.ends_with('"'));
        assert_eq!(json, serde_json::to_string(&err.to_string()).unwrap());
    }

    #[test]
    fn msg_variant_preserves_exact_text() {
        let err: AppError = "Secrets store is locked".into();
        assert_eq!(err.to_string(), "Secrets store is locked");
        assert_eq!(
            serde_json::to_string(&err).unwrap(),
            "\"Secrets store is locked\""
        );
    }

    #[test]
    fn into_string_round_trips_for_incremental_callers() {
        let err = AppError::Msg("nope".into());
        let s: String = err.into();
        assert_eq!(s, "nope");
    }

    #[test]
    fn a_coded_error_carries_its_code_beside_the_english_message() {
        let err = AppError::coded(ErrorCode::VaultRoleReadOnly, "No write access (viewer)")
            .with_param("role", "viewer");
        assert_eq!(
            serde_json::to_value(&err).unwrap(),
            serde_json::json!({
                "code": "vault-role-read-only",
                "message": "No write access (viewer)",
                "params": { "role": "viewer" },
            })
        );
        // Callers still on `Result<T, String>` see the message alone.
        assert_eq!(String::from(err), "No write access (viewer)");
    }

    #[test]
    fn a_coded_error_without_params_omits_them() {
        let err = AppError::coded(ErrorCode::VaultLocked, "Secrets store is locked");
        assert_eq!(
            serde_json::to_value(&err).unwrap(),
            serde_json::json!({ "code": "vault-locked", "message": "Secrets store is locked" })
        );
    }

    #[test]
    fn an_io_error_with_a_known_kind_is_coded() {
        let err = AppError::from(std::io::Error::from(ErrorKind::PermissionDenied));
        let json = serde_json::to_value(&err).unwrap();
        assert_eq!(json["code"], "permission-denied");
        assert_eq!(json["message"], err.to_string());
    }

    #[test]
    fn params_are_ignored_on_an_uncoded_error() {
        let err = AppError::Msg("plain".into()).with_param("x", 1);
        assert_eq!(serde_json::to_string(&err).unwrap(), "\"plain\"");
    }

    #[test]
    fn caused_keeps_the_context_message_and_the_causes_code() {
        let denied = std::io::Error::from(ErrorKind::PermissionDenied);
        let err = AppError::caused("Read failed", &denied);
        assert_eq!(err.to_string(), format!("Read failed: {denied}"));
        assert_eq!(err.code(), Some(ErrorCode::PermissionDenied));

        let other = AppError::caused("Read failed", &std::io::Error::other("odd"));
        assert_eq!(other.code(), None);
        assert_eq!(
            serde_json::to_string(&other).unwrap(),
            "\"Read failed: odd\""
        );
    }

    #[test]
    fn io_kinds_map_to_codes() {
        use ErrorCode as C;
        for (kind, want) in [
            (ErrorKind::PermissionDenied, Some(C::PermissionDenied)),
            (ErrorKind::NotFound, Some(C::NotFound)),
            (ErrorKind::AlreadyExists, Some(C::AlreadyExists)),
            (ErrorKind::StorageFull, Some(C::StorageFull)),
            (ErrorKind::QuotaExceeded, Some(C::StorageFull)),
            (ErrorKind::ConnectionRefused, Some(C::ConnectionRefused)),
            (ErrorKind::NetworkUnreachable, Some(C::HostUnreachable)),
            (ErrorKind::TimedOut, Some(C::TimedOut)),
            (ErrorKind::BrokenPipe, Some(C::ConnectionLost)),
            (ErrorKind::AddrInUse, None),
            (ErrorKind::Other, None),
        ] {
            assert_eq!(kind.error_code(), want, "{kind:?}");
        }
    }

    #[test]
    fn ssh_errors_map_to_codes() {
        let refused = russh::Error::IO(std::io::Error::from(ErrorKind::ConnectionRefused));
        assert_eq!(refused.error_code(), Some(ErrorCode::ConnectionRefused));
        assert_eq!(
            russh::Error::ConnectionTimeout.error_code(),
            Some(ErrorCode::TimedOut)
        );
        assert_eq!(russh::Error::NotAuthenticated.error_code(), None);
    }

    #[test]
    fn sftp_statuses_map_to_codes() {
        use russh_sftp::client::error::Error as Sftp;
        use russh_sftp::protocol::{Status, StatusCode};
        let status = |status_code| {
            Sftp::Status(Status {
                id: 0,
                status_code,
                error_message: String::new(),
                language_tag: String::new(),
            })
        };
        for (code, want) in [
            (StatusCode::NoSuchFile, Some(ErrorCode::NotFound)),
            (
                StatusCode::PermissionDenied,
                Some(ErrorCode::PermissionDenied),
            ),
            (StatusCode::ConnectionLost, Some(ErrorCode::ConnectionLost)),
            (StatusCode::NoConnection, Some(ErrorCode::ConnectionLost)),
            // v3 servers answer "Failure" for a full disk, an existing
            // directory and most else: nothing to name.
            (StatusCode::Failure, None),
        ] {
            assert_eq!(status(code).error_code(), want, "{code:?}");
        }
        assert_eq!(Sftp::Timeout.error_code(), Some(ErrorCode::TimedOut));
    }

    /// Every code the backend can send has an English translation; the locale
    /// parity test carries it to the other languages.
    #[test]
    fn every_code_has_an_english_translation() {
        let en: serde_json::Value =
            serde_json::from_str(include_str!("../../src/i18n/locales/en/errors.json")).unwrap();
        for code in ErrorCode::ALL {
            let key = serde_json::to_value(code).unwrap();
            let key = key.as_str().unwrap();
            assert!(
                en["errors"][key].is_string(),
                "errors.{key} is missing from en/errors.json"
            );
        }
    }
}
