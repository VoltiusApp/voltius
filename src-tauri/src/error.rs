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
    // File transfers.
    ConnectionLostResumable,
    TransferVerifyFailed,
    TransferSourceChanged,
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
    // HTTP file servers (WebDAV).
    LoginRejected,
    ResourceLocked,
    // Vault access. Shares its first two codes with the frontend's own VaultError.
    // Params: `role` for VaultRoleReadOnly.
    VaultLocked,
    VaultUnreadable,
    VaultSignInRequired,
    VaultReadOnly,
    VaultRoleReadOnly,
    VaultPermissionsUnavailable,
    VaultPermissionsCorrupted,
    // Port knocking.
    KnockUdpViaProxy,
}

/// A lower-level failure whose cause may have an [`ErrorCode`]. The one place
/// each library's error kinds are mapped; sites wrap them with [`AppError::caused`].
pub trait Classify {
    fn error_code(&self) -> Option<ErrorCode>;

    /// Values the code's translation interpolates, or that name where it failed.
    fn error_params(&self) -> Vec<(&'static str, String)> {
        Vec::new()
    }
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

/// An `AppError` carried inside an io error keeps its own code.
impl Classify for std::io::Error {
    fn error_code(&self) -> Option<ErrorCode> {
        match self.get_ref().and_then(|e| e.downcast_ref::<AppError>()) {
            Some(inner) => inner.code(),
            None => self.kind().error_code(),
        }
    }
}

impl Classify for crate::knock::KnockError {
    fn error_code(&self) -> Option<ErrorCode> {
        match self {
            crate::knock::KnockError::UdpViaProxy => Some(ErrorCode::KnockUdpViaProxy),
            crate::knock::KnockError::Io(e) => e.error_code(),
        }
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

/// A proxy's own verdicts (a refused CONNECT, a SOCKS reply) have no code;
/// failing to reach it, or it never answering, do, and name the proxy.
impl Classify for crate::proxy::ProxyError {
    fn error_code(&self) -> Option<ErrorCode> {
        use crate::proxy::ProxyError as P;
        match self {
            P::Direct(e) | P::Unreachable { source: e, .. } => e.error_code(),
            P::Timeout { .. } => Some(ErrorCode::TimedOut),
            P::Rejected { .. } | P::Socks { .. } | P::Protocol { .. } => None,
        }
    }

    fn error_params(&self) -> Vec<(&'static str, String)> {
        use crate::proxy::ProxyError as P;
        match self {
            P::Unreachable { proxy, .. } | P::Timeout { proxy } => vec![("proxy", proxy.clone())],
            _ => Vec::new(),
        }
    }
}

/// A host-key verdict is shown as is, so it has no code.
impl Classify for crate::ssh::client::HopError {
    fn error_code(&self) -> Option<ErrorCode> {
        use crate::ssh::client::HopError as H;
        match self {
            H::Knock(e) => e.error_code(),
            H::AfterKnock(e) => e.error_code(),
            H::Proxy(e) => e.error_code(),
            H::Ssh(e) => e.error_code(),
            H::HostKey(_) => None,
        }
    }

    fn error_params(&self) -> Vec<(&'static str, String)> {
        use crate::ssh::client::HopError as H;
        match self {
            H::AfterKnock(e) => e.error_params(),
            H::Proxy(e) => e.error_params(),
            H::Knock(_) | H::Ssh(_) | H::HostKey(_) => Vec::new(),
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
        Self::maybe_coded(cause, format!("{context}: {cause}"))
    }

    /// `cause`'s own text, coded after it when it has a code.
    pub fn classified(cause: &(impl Classify + Display)) -> Self {
        Self::maybe_coded(cause, cause.to_string())
    }

    fn maybe_coded(cause: &impl Classify, message: String) -> Self {
        let Some(code) = cause.error_code() else {
            return AppError::Msg(message);
        };
        cause
            .error_params()
            .into_iter()
            .fold(AppError::coded(code, message), |err, (k, v)| {
                err.with_param(k, v)
            })
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
    fn an_unreachable_proxy_is_named_beside_the_hosts_code() {
        use crate::proxy::ProxyError;
        use crate::ssh::client::HopError;
        let refused = HopError::Proxy(ProxyError::Unreachable {
            proxy: "corp:3128".into(),
            source: std::io::Error::from(ErrorKind::ConnectionRefused),
        });
        let json = serde_json::to_value(AppError::caused("Connection failed", &refused)).unwrap();
        assert_eq!(json["code"], "connection-refused");
        assert_eq!(json["params"]["proxy"], "corp:3128");

        let target = HopError::Proxy(ProxyError::Direct(std::io::Error::from(
            ErrorKind::ConnectionRefused,
        )));
        let json = serde_json::to_value(AppError::caused("Connection failed", &target)).unwrap();
        assert_eq!(json["code"], "connection-refused");
        assert!(json.get("params").is_none());
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
