//! Unified application error type.
//!
//! `AppError` is the single error type that backend logic and Tauri commands
//! converge on. It carries rich typed variants internally (so `?` can convert
//! `io::Error`, `serde_json::Error`, …) but **serializes as a plain string** —
//! the exact same wire shape Tauri commands have always returned with
//! `Result<T, String>`. This keeps the IPC contract with the frontend byte
//! identical while letting Rust code drop hand-written `.map_err(|e| e.to_string())`.
//!
//! Migration is intentionally module-by-module; see the Phase 1 refactor plan.

use thiserror::Error;

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

/// Serialize as a bare string so Tauri's IPC layer hands the frontend the same
/// value it always received from `Result<T, String>` — no contract change.
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_to_a_bare_json_string() {
        let err = AppError::from(std::io::Error::new(std::io::ErrorKind::NotFound, "boom"));
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
}
