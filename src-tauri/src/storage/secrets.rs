use crate::error::AppError;
use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    Key, XChaCha20Poly1305, XNonce,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Manager;

pub struct SecretsStore {
    inner: Mutex<Option<StoreInner>>,
}

struct StoreInner {
    enc_key: [u8; 32],
    secrets: HashMap<String, String>,
    /// Per-secret last-write timestamps (RFC3339). A key present here but absent
    /// from `secrets` is a tombstone: a deletion that must still propagate on sync.
    clocks: HashMap<String, String>,
    path: PathBuf,
}

const NONCE_LEN: usize = 24;

/// Reported verbatim to the frontend, which classifies the locked vault by matching
/// it; see `the_locked_error_text_matches_the_frontend`.
pub const LOCKED_ERR: &str = "Secrets store is locked";

/// On-disk / in-blob representation of the secrets store.
#[derive(serde::Serialize, serde::Deserialize, Default)]
pub struct SecretsData {
    pub secrets: HashMap<String, String>,
    #[serde(default)]
    pub clocks: HashMap<String, String>,
}

fn now_ts() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn secrets_path(app: &AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .expect("failed to get app data dir");
    std::fs::create_dir_all(&dir).ok();
    dir.join("secrets.enc")
}

impl SecretsStore {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }

    pub fn unlock(&self, path: PathBuf, enc_key: [u8; 32]) -> Result<(), AppError> {
        let data = if path.exists() {
            let bytes = std::fs::read(&path).map_err(|e| format!("Read failed: {e}"))?;
            decrypt(&enc_key, &bytes)?
        } else {
            SecretsData::default()
        };
        *self.inner.lock().unwrap() = Some(StoreInner {
            enc_key,
            secrets: data.secrets,
            clocks: data.clocks,
            path,
        });
        Ok(())
    }

    pub fn lock(&self) {
        *self.inner.lock().unwrap() = None;
    }

    pub fn get(&self, key: &str) -> Result<Option<String>, AppError> {
        let guard = self.inner.lock().unwrap();
        let inner = guard.as_ref().ok_or(LOCKED_ERR)?;
        Ok(inner.secrets.get(key).cloned())
    }

    pub fn set(&self, key: String, value: String) -> Result<(), AppError> {
        let mut guard = self.inner.lock().unwrap();
        let inner = guard.as_mut().ok_or(LOCKED_ERR)?;
        inner.clocks.insert(key.clone(), now_ts());
        inner.secrets.insert(key, value);
        save(inner)
    }

    pub fn delete(&self, key: &str) -> Result<(), AppError> {
        let mut guard = self.inner.lock().unwrap();
        let inner = guard.as_mut().ok_or(LOCKED_ERR)?;
        inner.secrets.remove(key);
        // Leave a tombstone (clock without value) so the deletion propagates on sync.
        inner.clocks.insert(key.to_string(), now_ts());
        save(inner)
    }

    #[allow(dead_code)]
    pub fn is_unlocked(&self) -> bool {
        self.inner.lock().unwrap().is_some()
    }

    /// Export all secrets plus their per-secret clocks (for backup/sync export).
    pub fn export_all(&self) -> Result<SecretsData, AppError> {
        let guard = self.inner.lock().unwrap();
        let inner = guard.as_ref().ok_or(LOCKED_ERR)?;
        Ok(SecretsData {
            secrets: inner.secrets.clone(),
            clocks: inner.clocks.clone(),
        })
    }

    /// Replace the store with a merged secrets+clocks set (from a sync merge or a
    /// full backup restore). Replacing rather than extending lets deletions apply:
    /// a key merged away (tombstoned) is removed from the live secret map.
    pub fn replace_all(
        &self,
        secrets: HashMap<String, String>,
        clocks: HashMap<String, String>,
    ) -> Result<(), AppError> {
        let mut guard = self.inner.lock().unwrap();
        let inner = guard.as_mut().ok_or(LOCKED_ERR)?;
        inner.secrets = secrets;
        inner.clocks = clocks;
        save(inner)
    }
}

fn save(inner: &StoreInner) -> Result<(), AppError> {
    let data = SecretsData {
        secrets: inner.secrets.clone(),
        clocks: inner.clocks.clone(),
    };
    let json = serde_json::to_vec(&data)?;
    let encrypted = encrypt(&inner.enc_key, &json)?;
    write_atomic(&inner.path, &encrypted)
}

/// The directory and file name of `path`, the two parts every vault file operation
/// needs before it can name a sibling.
fn dir_and_name(path: &std::path::Path) -> Result<(&std::path::Path, &str), AppError> {
    let dir = path.parent().ok_or("Vault path has no parent directory")?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Vault path has no file name")?;
    Ok((dir, name))
}

/// Sibling scratch path for a staged write. A sibling keeps the rename on one
/// filesystem, which is what makes it atomic.
fn temp_path(path: &std::path::Path) -> Result<PathBuf, AppError> {
    let (dir, name) = dir_and_name(path)?;
    Ok(dir.join(format!("{name}.tmp")))
}

/// Write `bytes` to `path` through a staged sibling file, so an interrupted write
/// leaves the previous vault intact rather than a truncated one that no key opens.
fn write_atomic(path: &std::path::Path, bytes: &[u8]) -> Result<(), AppError> {
    write_atomic_via(path, &temp_path(path)?, bytes)
}

fn write_atomic_via(
    path: &std::path::Path,
    tmp: &std::path::Path,
    bytes: &[u8],
) -> Result<(), AppError> {
    stage(tmp, path, bytes)?;
    std::fs::rename(tmp, path).map_err(|e| {
        let _ = std::fs::remove_file(tmp);
        AppError::Msg(format!("Write failed: {e}"))
    })
}

/// Fully materialise `bytes` at `tmp`, flushed to disk before the caller renames:
/// without the sync the rename can land ahead of the data it is meant to commit.
/// A failure removes the scratch file, so no half-written sibling is left behind.
/// The scratch file takes `like`'s permissions, which the rename then carries over.
fn stage(tmp: &std::path::Path, like: &std::path::Path, bytes: &[u8]) -> Result<(), AppError> {
    match write_and_sync(tmp, like, bytes) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(tmp);
            Err(e)
        }
    }
}

fn write_and_sync(
    tmp: &std::path::Path,
    like: &std::path::Path,
    bytes: &[u8],
) -> Result<(), AppError> {
    use std::io::Write;
    let mut file = open_staged(tmp, like).map_err(|e| format!("Write failed: {e}"))?;
    file.write_all(bytes)
        .map_err(|e| format!("Write failed: {e}"))?;
    file.sync_all().map_err(|e| format!("Write failed: {e}"))?;
    Ok(())
}

/// A fresh scratch file wearing `like`'s mode, or owner-only when `like` is not
/// there yet: a default-permission temp file would widen a vault the user tightened
/// as soon as the rename carried its mode over.
#[cfg(unix)]
fn open_staged(tmp: &std::path::Path, like: &std::path::Path) -> std::io::Result<std::fs::File> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let mode = std::fs::metadata(like)
        .map(|m| m.permissions().mode() & 0o777)
        .unwrap_or(0o600);
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(mode)
        .open(tmp)?;
    // A leftover scratch file keeps its own mode through open(): set it either way.
    file.set_permissions(std::fs::Permissions::from_mode(mode))?;
    Ok(file)
}

#[cfg(not(unix))]
fn open_staged(tmp: &std::path::Path, _like: &std::path::Path) -> std::io::Result<std::fs::File> {
    std::fs::File::create(tmp)
}

fn encrypt(key: &[u8; 32], plaintext: &[u8]) -> Result<Vec<u8>, AppError> {
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let nonce = XChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {e}"))?;
    let mut out = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    out.extend_from_slice(&nonce);
    out.extend_from_slice(&ciphertext);
    Ok(out)
}

fn decrypt(key: &[u8; 32], data: &[u8]) -> Result<SecretsData, AppError> {
    if data.len() < NONCE_LEN {
        return Err("Secrets file too short".into());
    }
    let nonce = XNonce::from_slice(&data[..NONCE_LEN]);
    let cipher = XChaCha20Poly1305::new(Key::from_slice(key));
    let plaintext = cipher
        .decrypt(nonce, &data[NONCE_LEN..])
        .map_err(|_| "Decryption failed — wrong key or corrupted file".to_string())?;
    parse_secrets(&plaintext)
}

/// Parse decrypted bytes as a [`SecretsData`] envelope, tolerating the legacy
/// format (a bare `{key: value}` map written before per-secret clocks existed).
fn parse_secrets(plaintext: &[u8]) -> Result<SecretsData, AppError> {
    let value: serde_json::Value = serde_json::from_slice(plaintext)?;
    // Envelope form: an object with a `secrets` object field.
    if value.get("secrets").map(|s| s.is_object()).unwrap_or(false) {
        return Ok(serde_json::from_value(value)?);
    }
    // Legacy form: the whole object is the secrets map (clocks unknown → empty).
    let secrets: HashMap<String, String> = serde_json::from_value(value)?;
    Ok(SecretsData {
        secrets,
        clocks: HashMap::new(),
    })
}

// ─── Tauri commands ───────────────────────────────────────────────────────────

#[tauri::command]
pub fn secrets_unlock(
    app: AppHandle,
    state: tauri::State<SecretsStore>,
    enc_key: Vec<u8>,
) -> Result<(), AppError> {
    let key: [u8; 32] = enc_key.try_into().map_err(|_| "enc_key must be 32 bytes")?;
    let path = secrets_path(&app);
    state.unlock(path, key)
}

#[tauri::command]
pub fn secrets_verify(
    app: AppHandle,
    _state: tauri::State<SecretsStore>,
    enc_key: Vec<u8>,
) -> Result<(), AppError> {
    let key: [u8; 32] = enc_key.try_into().map_err(|_| "enc_key must be 32 bytes")?;
    let path = secrets_path(&app);
    // If no file yet, key is always valid (will be created on first write)
    if !path.exists() {
        return Ok(());
    }
    // Try to decrypt without mutating state
    let data = std::fs::read(&path).map_err(|e| format!("Read failed: {e}"))?;
    decrypt(&key, &data).map(|_| ())
}

#[tauri::command]
pub fn secrets_exists(app: AppHandle) -> bool {
    secrets_path(&app).exists()
}

#[tauri::command]
pub fn secrets_lock(state: tauri::State<SecretsStore>) {
    state.lock();
}

/// Re-encrypt the secrets store with a new key (used for account migration).
#[tauri::command]
pub fn secrets_reencrypt(
    state: tauri::State<SecretsStore>,
    new_enc_key: Vec<u8>,
) -> Result<(), AppError> {
    let new_key: [u8; 32] = new_enc_key
        .try_into()
        .map_err(|_| "new_enc_key must be 32 bytes")?;
    let mut guard = state.inner.lock().unwrap();
    let inner = guard.as_mut().ok_or(LOCKED_ERR)?;
    inner.enc_key = new_key;
    save(inner)
}

/// Re-key the secrets store: decrypt with old_key, re-encrypt with new_key.
/// Used during the KEK/DEK migration when the DEK changes.
#[tauri::command]
pub fn secrets_rekey(
    app: AppHandle,
    state: tauri::State<SecretsStore>,
    old_enc_key: Vec<u8>,
    new_enc_key: Vec<u8>,
) -> Result<(), AppError> {
    let old_key: [u8; 32] = old_enc_key
        .try_into()
        .map_err(|_| "old_enc_key must be 32 bytes")?;
    let new_key: [u8; 32] = new_enc_key
        .try_into()
        .map_err(|_| "new_enc_key must be 32 bytes")?;

    let path = secrets_path(&app);
    let data = if path.exists() {
        let bytes = std::fs::read(&path).map_err(|e| format!("Read failed: {e}"))?;
        decrypt(&old_key, &bytes)?
    } else {
        SecretsData::default()
    };

    let mut guard = state.inner.lock().unwrap();
    let inner = guard.as_mut().ok_or(LOCKED_ERR)?;
    inner.secrets = data.secrets;
    inner.clocks = data.clocks;
    inner.enc_key = new_key;
    save(inner)
}

#[tauri::command]
pub fn secrets_get(
    state: tauri::State<SecretsStore>,
    key: String,
) -> Result<Option<String>, AppError> {
    state.get(&key)
}

#[tauri::command]
pub fn secrets_set(
    state: tauri::State<SecretsStore>,
    key: String,
    value: String,
) -> Result<(), AppError> {
    state.set(key, value)
}

#[tauri::command]
pub fn secrets_delete(state: tauri::State<SecretsStore>, key: String) -> Result<(), AppError> {
    state.delete(&key)
}

const QUARANTINE_KEEP: usize = 3;

/// Rename `path` aside as `<name>.<unix_millis>.bak`, keeping the newest `keep`.
/// Never deletes it: an unreadable vault may still open with a key found later.
fn quarantine_at(path: &std::path::Path, keep: usize) -> Result<String, AppError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Clock error: {e}"))?
        .as_millis();
    quarantine_at_millis(path, keep, now)
}

/// `now` is injected so the naming invariant is testable without depending on how
/// many quarantines happen to share a millisecond.
fn quarantine_at_millis(
    path: &std::path::Path,
    keep: usize,
    now: u128,
) -> Result<String, AppError> {
    let moved = rename_aside(path, now)?;
    let (dir, name) = dir_and_name(path)?;
    prune_backups(dir, name, keep);
    Ok(moved)
}

/// Move `path` to the next free `<name>.<stamp>.bak`, without pruning: the caller
/// decides whether retention runs.
fn rename_aside(path: &std::path::Path, now: u128) -> Result<String, AppError> {
    if !path.exists() {
        return Err("No vault file to set aside".into());
    }
    let (target, file) = next_backup_path(path, now, false)?;
    std::fs::rename(path, &target).map_err(|e| format!("Set aside failed: {e}"))?;
    Ok(file)
}

/// The next free backup path beside `path`, and its file name.
fn next_backup_path(
    path: &std::path::Path,
    now: u128,
    displaced: bool,
) -> Result<(PathBuf, String), AppError> {
    let (dir, name) = dir_and_name(path)?;
    let marker = if displaced { DISPLACED_MARKER } else { "" };

    // Must sort after every surviving backup: "now" alone can reuse a stamp that
    // pruning just freed within the same millisecond.
    let mut ts = match newest_backup_stamp(dir, name) {
        Some(latest) if latest >= now => latest + 1,
        _ => now,
    };
    let mut file = format!("{name}.{ts}{marker}.bak");
    while dir.join(&file).exists() {
        ts += 1;
        file = format!("{name}.{ts}{marker}.bak");
    }
    Ok((dir.join(&file), file))
}

/// A vault backup offered to the user for restoring.
#[derive(serde::Serialize)]
pub struct VaultBackup {
    pub file: String,
    pub stamp_millis: u64,
    pub size: u64,
}

/// Backups of `name` in `dir`, newest first — the order the list is shown in.
fn list_backups(dir: &std::path::Path, name: &str) -> Vec<VaultBackup> {
    let mut out: Vec<VaultBackup> = backup_paths(dir, name)
        .into_iter()
        .map(|(b, path)| VaultBackup {
            file: path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default()
                .to_string(),
            stamp_millis: b.stamp as u64,
            size: std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0),
        })
        .collect();
    out.reverse();
    out
}

/// Put the backup `file` back over the vault at `path`, keeping the current vault
/// as a new backup. Nothing is deleted: the backup stays where it is, so a wrong
/// choice can be undone by restoring another. Returns the name the current vault
/// was kept as, or None when there was no vault to displace.
fn restore_backup_at(
    path: &std::path::Path,
    file: &str,
    now: u128,
) -> Result<Option<String>, AppError> {
    let source = resolve_backup(path, file)?;

    // Staged before anything moves, so a failed read cannot leave the vault gone.
    let bytes = std::fs::read(&source).map_err(|e| format!("Read failed: {e}"))?;
    let tmp = temp_path(path)?;
    stage(&tmp, path, &bytes)?;

    let restored = commit_restore(path, &tmp, now);
    if restored.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    restored
}

/// Copy the current vault aside, then move the staged file into its place. Copying
/// rather than renaming keeps a file at `path` at every instant: a crash between the
/// two would otherwise leave no vault at all, which the next launch reads as a first
/// launch and offers to create an account over.
fn commit_restore(
    path: &std::path::Path,
    tmp: &std::path::Path,
    now: u128,
) -> Result<Option<String>, AppError> {
    let displaced = match std::fs::read(path) {
        Ok(current) => {
            let (target, file) = next_backup_path(path, now, true)?;
            stage(&target, path, &current)?;
            Some((target, file))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Read failed: {e}").into()),
    };
    if let Err(e) = std::fs::rename(tmp, path) {
        if let Some((target, _)) = &displaced {
            let _ = std::fs::remove_file(target);
        }
        return Err(format!("Restore failed: {e}").into());
    }
    Ok(displaced.map(|(_, file)| file))
}

/// The backup `file` names beside `path`. Called before the store is locked, so a
/// rejected restore leaves the running app's secrets readable.
fn resolve_backup(path: &std::path::Path, file: &str) -> Result<PathBuf, AppError> {
    let (dir, name) = dir_and_name(path)?;
    if !is_backup_name(file, name) {
        return Err("Not a vault backup".into());
    }
    let source = dir.join(file);
    if !source.is_file() {
        return Err("That backup is no longer on disk".into());
    }
    Ok(source)
}

/// A backup this vault set aside, as named on disk.
struct BackupName {
    stamp: u128,
    /// Kept by a restore rather than a quarantine, and so still untried: retention
    /// stands down while one of these exists.
    displaced: bool,
}

const DISPLACED_MARKER: &str = ".displaced";

/// `<name>.<digits>[.displaced].bak` and nothing else.
fn parse_backup_name(file: &str, name: &str) -> Option<BackupName> {
    let rest = file
        .strip_prefix(&format!("{name}."))?
        .strip_suffix(".bak")?;
    let (stamp, displaced) = match rest.strip_suffix(DISPLACED_MARKER) {
        Some(stamp) => (stamp, true),
        None => (rest, false),
    };
    Some(BackupName {
        stamp: stamp.parse().ok()?,
        displaced,
    })
}

/// A backup of this vault — the argument arrives from the frontend, so a name that
/// could escape the vault directory is rejected here.
fn is_backup_name(file: &str, name: &str) -> bool {
    if file.contains('/') || file.contains('\\') || file.contains("..") {
        return false;
    }
    parse_backup_name(file, name).is_some()
}

/// Existing backups of `name` in `dir`, oldest first by embedded stamp.
fn backup_paths(dir: &std::path::Path, name: &str) -> Vec<(BackupName, PathBuf)> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut backups: Vec<(BackupName, PathBuf)> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter_map(|p| {
            let parsed = parse_backup_name(p.file_name()?.to_str()?, name)?;
            Some((parsed, p))
        })
        .collect();
    backups.sort_by_key(|(b, _)| b.stamp);
    backups
}

fn newest_backup_stamp(dir: &std::path::Path, name: &str) -> Option<u128> {
    backup_paths(dir, name).last().map(|(b, _)| b.stamp)
}

/// Best-effort retention: a failed prune leaves extra backups, never fewer.
/// Suspended entirely while a restore has displaced a vault, because a recovery run
/// adds a backup per attempt: counting those against the budget would delete the
/// backups the user has not tried yet, from under the list they are picking from.
fn prune_backups(dir: &std::path::Path, name: &str, keep: usize) {
    let backups = backup_paths(dir, name);
    if backups.iter().any(|(b, _)| b.displaced) {
        return;
    }
    let excess = backups.len().saturating_sub(keep);
    for (_, old) in backups.iter().take(excess) {
        let _ = std::fs::remove_file(old);
    }
}

/// Set an unreadable secrets.enc aside and lock the store: the next unlock starts
/// empty and the sync pull repopulates it.
#[tauri::command]
pub fn secrets_quarantine(
    app: AppHandle,
    state: tauri::State<SecretsStore>,
) -> Result<String, AppError> {
    state.lock();
    quarantine_at(&secrets_path(&app), QUARANTINE_KEEP)
}

/// Vault backups available to restore, newest first.
#[tauri::command]
pub fn secrets_backups(app: AppHandle) -> Vec<VaultBackup> {
    let path = secrets_path(&app);
    match dir_and_name(&path) {
        Ok((dir, name)) => list_backups(dir, name),
        Err(_) => Vec::new(),
    }
}

/// Put a backup back in place, keeping the current vault as a new backup, and
/// lock the store: the restored file answers to whichever key encrypted it, so
/// the caller reloads into the unlock screen.
#[tauri::command]
pub fn secrets_restore(
    app: AppHandle,
    state: tauri::State<SecretsStore>,
    file: String,
) -> Result<Option<String>, AppError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Clock error: {e}"))?
        .as_millis();
    let path = secrets_path(&app);
    // Rejected before the store is locked: a refused restore must not leave the
    // running app holding a vault it can no longer read from.
    resolve_backup(&path, &file)?;
    state.lock();
    restore_backup_at(&path, &file, now)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_legacy_bare_map_with_empty_clocks() {
        // Secrets written before per-secret clocks existed: a bare {key: value} map.
        let legacy = br#"{"password:c1":"secret","key:k1:private":"pem"}"#;
        let data = parse_secrets(legacy).expect("legacy parse");
        assert_eq!(data.secrets.get("password:c1").unwrap(), "secret");
        assert_eq!(data.secrets.get("key:k1:private").unwrap(), "pem");
        assert!(data.clocks.is_empty(), "legacy secrets have no clocks");
    }

    #[test]
    fn parses_envelope_with_clocks() {
        let envelope = br#"{"secrets":{"password:c1":"v"},"clocks":{"password:c1":"2026-07-21T00:00:00Z","password:c2":"2026-07-20T00:00:00Z"}}"#;
        let data = parse_secrets(envelope).expect("envelope parse");
        assert_eq!(data.secrets.get("password:c1").unwrap(), "v");
        // A clock with no matching live secret is a tombstone (deleted secret).
        assert_eq!(
            data.clocks.get("password:c2").unwrap(),
            "2026-07-20T00:00:00Z"
        );
        assert!(!data.secrets.contains_key("password:c2"));
    }

    #[test]
    fn parses_envelope_without_clocks_field() {
        let envelope = br#"{"secrets":{"password:c1":"v"}}"#;
        let data = parse_secrets(envelope).expect("envelope parse");
        assert_eq!(data.secrets.get("password:c1").unwrap(), "v");
        assert!(data.clocks.is_empty());
    }

    #[test]
    fn envelope_round_trips_through_serde() {
        let mut secrets = HashMap::new();
        secrets.insert("password:c1".to_string(), "v".to_string());
        let mut clocks = HashMap::new();
        clocks.insert(
            "password:c1".to_string(),
            "2026-07-21T00:00:00Z".to_string(),
        );
        let json = serde_json::to_vec(&SecretsData {
            secrets: secrets.clone(),
            clocks: clocks.clone(),
        })
        .unwrap();
        let back = parse_secrets(&json).unwrap();
        assert_eq!(back.secrets, secrets);
        assert_eq!(back.clocks, clocks);
    }

    fn backups(dir: &std::path::Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".bak"))
            .collect();
        names.sort();
        names
    }

    #[test]
    fn quarantine_renames_instead_of_deleting() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.enc");
        std::fs::write(&path, b"ciphertext").unwrap();

        let name = quarantine_at(&path, 3).expect("quarantine");

        assert!(
            !path.exists(),
            "the unreadable file must be moved, not left"
        );
        let moved = dir.path().join(&name);
        assert_eq!(std::fs::read(&moved).unwrap(), b"ciphertext");
    }

    /// Quarantine `count` times on one frozen clock — what a fast machine produces.
    fn quarantine_repeatedly(dir: &std::path::Path, keep: usize, count: u8) -> Vec<String> {
        let path = dir.join("secrets.enc");
        (0..count)
            .map(|i| {
                std::fs::write(&path, [i]).unwrap();
                quarantine_at_millis(&path, keep, 1_000).expect("quarantine")
            })
            .collect()
    }

    #[test]
    fn quarantine_keeps_only_the_newest_backups() {
        let dir = tempfile::tempdir().unwrap();
        let created = quarantine_repeatedly(dir.path(), 3, 5);

        let kept = backups(dir.path());
        assert_eq!(kept.len(), 3, "retention keeps three, found {kept:?}");
        assert_eq!(kept, created[2..].to_vec(), "the newest three survive");
    }

    // Pruning frees the oldest name; reusing it would make the newest backup sort as
    // the oldest, so the next prune would delete the newest instead.
    #[test]
    fn quarantine_never_reuses_a_pruned_name() {
        let dir = tempfile::tempdir().unwrap();
        let created = quarantine_repeatedly(dir.path(), 1, 3);

        assert_eq!(backups(dir.path()), vec![created[2].clone()]);
        assert!(
            created[1] > created[0] && created[2] > created[1],
            "names must increase on one clock tick: {created:?}"
        );
    }

    #[test]
    fn quarantine_errors_when_there_is_no_vault_file() {
        let dir = tempfile::tempdir().unwrap();
        assert!(quarantine_at(&dir.path().join("secrets.enc"), 3).is_err());
    }

    // A truncating write loses the vault if the process dies mid-write. The staged
    // write is made to fail by pointing the temp path at a directory.
    #[test]
    fn an_interrupted_write_leaves_the_previous_vault_intact() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.enc");
        write_atomic(&path, b"v1").expect("first write");

        let blocked = dir.path().join("blocked.tmp");
        std::fs::create_dir(&blocked).unwrap();
        assert!(write_atomic_via(&path, &blocked, b"v2").is_err());

        assert_eq!(std::fs::read(&path).unwrap(), b"v1");
    }

    #[test]
    fn a_completed_write_replaces_the_content_and_leaves_no_temp_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.enc");
        write_atomic(&path, b"v1").expect("first write");
        write_atomic(&path, b"v2").expect("second write");

        assert_eq!(std::fs::read(&path).unwrap(), b"v2");
        let strays: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(strays.is_empty(), "temp file left behind: {strays:?}");
    }

    // The temp file must be a sibling: a rename across filesystems is not atomic.
    #[test]
    fn the_temp_file_sits_beside_the_vault() {
        let path = std::path::Path::new("/data/app/secrets.enc");
        assert_eq!(
            temp_path(path).unwrap(),
            std::path::Path::new("/data/app/secrets.enc.tmp")
        );
    }

    /// A vault plus `count` backups on a frozen clock, newest last.
    fn vault_with_backups(dir: &std::path::Path, count: u8) -> PathBuf {
        let path = dir.join("secrets.enc");
        for i in 0..count {
            std::fs::write(&path, [i]).unwrap();
            rename_aside(&path, 1_000).unwrap();
        }
        std::fs::write(&path, b"current").unwrap();
        path
    }

    #[test]
    fn backups_are_listed_newest_first_with_their_stamp_and_size() {
        let dir = tempfile::tempdir().unwrap();
        vault_with_backups(dir.path(), 3);

        let listed = list_backups(dir.path(), "secrets.enc");

        let stamps: Vec<u64> = listed.iter().map(|b| b.stamp_millis).collect();
        assert_eq!(stamps, vec![1_002, 1_001, 1_000], "newest first");
        assert!(listed.iter().all(|b| b.size == 1));
        assert_eq!(listed[0].file, "secrets.enc.1002.bak");
    }

    #[test]
    fn listing_ignores_files_that_are_not_backups() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("secrets.enc"), b"live").unwrap();
        std::fs::write(dir.path().join("secrets.enc.tmp"), b"partial").unwrap();
        std::fs::write(dir.path().join("notes.txt.1000.bak"), b"other").unwrap();

        assert!(list_backups(dir.path(), "secrets.enc").is_empty());
    }

    #[test]
    fn restoring_puts_the_backup_back_and_sets_the_current_vault_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = vault_with_backups(dir.path(), 1);

        let set_aside = restore_backup_at(&path, "secrets.enc.1000.bak", 2_000)
            .expect("restore")
            .expect("the current vault must be kept");

        assert_eq!(std::fs::read(&path).unwrap(), [0]);
        assert_eq!(
            std::fs::read(dir.path().join(&set_aside)).unwrap(),
            b"current"
        );
    }

    // Restoring must be undoable: the backup it read stays on disk, and nothing
    // is pruned, so the source cannot be the file retention deletes.
    #[test]
    fn restoring_leaves_every_backup_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let path = vault_with_backups(dir.path(), 3);

        restore_backup_at(&path, "secrets.enc.1000.bak", 2_000).expect("restore");

        let kept = backups(dir.path());
        assert!(
            kept.contains(&"secrets.enc.1000.bak".to_string()),
            "source survives"
        );
        assert_eq!(
            kept.len(),
            4,
            "the displaced vault is added, none pruned: {kept:?}"
        );
    }

    #[test]
    fn restoring_with_no_current_vault_reports_nothing_set_aside() {
        let dir = tempfile::tempdir().unwrap();
        let path = vault_with_backups(dir.path(), 1);
        std::fs::remove_file(&path).unwrap();

        let set_aside = restore_backup_at(&path, "secrets.enc.1000.bak", 2_000).expect("restore");

        assert!(set_aside.is_none());
        assert_eq!(std::fs::read(&path).unwrap(), [0]);
    }

    // The name arrives from the frontend, so it must not be able to reach outside
    // the vault directory or name a file that is not a backup.
    #[test]
    fn restoring_rejects_a_name_that_is_not_this_vaults_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = vault_with_backups(dir.path(), 1);
        std::fs::write(dir.path().join("secrets.enc.notastamp.bak"), b"x").unwrap();

        for bad in [
            "../secrets.enc.1000.bak",
            "/etc/passwd",
            "secrets.enc",
            "secrets.enc.notastamp.bak",
            "other.enc.1000.bak",
        ] {
            assert!(
                restore_backup_at(&path, bad, 2_000).is_err(),
                "accepted {bad}"
            );
        }
        assert_eq!(std::fs::read(&path).unwrap(), b"current", "vault untouched");
    }

    #[test]
    fn restoring_a_backup_that_is_gone_errors_without_touching_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        let path = vault_with_backups(dir.path(), 1);

        assert!(restore_backup_at(&path, "secrets.enc.9999.bak", 2_000).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"current");
    }

    // The recovery screen's "set aside and start fresh" button sits directly above
    // the backup list, so pressing it after a restore that did not help must not
    // delete the backups still listed there and never tried.
    #[test]
    fn quarantining_after_a_restore_keeps_the_untried_backups() {
        let dir = tempfile::tempdir().unwrap();
        let path = vault_with_backups(dir.path(), 3);
        restore_backup_at(&path, "secrets.enc.1002.bak", 2_000).expect("restore");

        quarantine_at_millis(&path, 3, 3_000).expect("quarantine");

        let kept = backups(dir.path());
        for untried in ["secrets.enc.1000.bak", "secrets.enc.1001.bak"] {
            assert!(
                kept.contains(&untried.to_string()),
                "{untried} lost: {kept:?}"
            );
        }
    }

    // Retention resumes once no restore-displaced backup is left.
    #[test]
    fn quarantining_without_a_restore_still_prunes() {
        let dir = tempfile::tempdir().unwrap();
        let path = vault_with_backups(dir.path(), 3);

        quarantine_at_millis(&path, 3, 3_000).expect("quarantine");

        assert_eq!(backups(dir.path()).len(), 3);
    }

    // A restore that fails after the vault has been set aside must leave the old
    // vault where it was: renaming it away first left the data dir with no
    // secrets.enc at all, which the next launch reads as a first launch.
    #[test]
    fn a_restore_that_fails_at_the_last_step_leaves_the_old_vault_in_place() {
        let dir = tempfile::tempdir().unwrap();
        let path = vault_with_backups(dir.path(), 1);
        let never_staged = dir.path().join("secrets.enc.tmp");

        assert!(commit_restore(&path, &never_staged, 2_000).is_err());

        assert_eq!(std::fs::read(&path).unwrap(), b"current");
        assert_eq!(
            backups(dir.path()),
            vec!["secrets.enc.1000.bak".to_string()]
        );
    }

    // Failing to set the vault aside must not leave the staged secrets.enc.tmp on
    // disk: stage() only cleans up its own failures. A directory in the vault's
    // place is a vault that cannot be read or replaced.
    #[test]
    fn a_restore_that_cannot_set_the_vault_aside_leaves_no_staged_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = vault_with_backups(dir.path(), 1);
        std::fs::remove_file(&path).unwrap();
        std::fs::create_dir(&path).unwrap();

        assert!(restore_backup_at(&path, "secrets.enc.1000.bak", 2_000).is_err());

        assert!(!dir.path().join("secrets.enc.tmp").exists());
    }

    #[cfg(unix)]
    fn mode_of(path: &std::path::Path) -> u32 {
        use std::os::unix::fs::PermissionsExt;
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    // The rename carries the staged file's mode onto the vault, so a default-mode
    // temp file would widen a vault the user tightened on the next save.
    #[cfg(unix)]
    #[test]
    fn the_staged_write_keeps_the_vaults_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("secrets.enc");

        write_atomic(&path, b"v1").expect("first write");
        assert_eq!(mode_of(&path), 0o600, "a new vault is owner-only");

        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o640)).unwrap();
        write_atomic(&path, b"v2").expect("second write");
        assert_eq!(mode_of(&path), 0o640, "the user's mode survives a save");
    }

    #[cfg(unix)]
    #[test]
    fn a_restored_vault_and_its_displaced_backup_keep_the_vaults_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = vault_with_backups(dir.path(), 1);
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();

        let set_aside = restore_backup_at(&path, "secrets.enc.1000.bak", 2_000)
            .expect("restore")
            .expect("the current vault must be kept");

        assert_eq!(mode_of(&path), 0o600);
        assert_eq!(mode_of(&dir.path().join(set_aside)), 0o600);
    }

    // src/services/vault.ts classifies a locked vault by matching this exact text,
    // so a rename that does not reach the frontend must fail here.
    #[test]
    fn the_locked_error_text_matches_the_frontend() {
        assert_eq!(LOCKED_ERR, "Secrets store is locked");
    }

    // backup_paths must not mistake an interrupted write for a restorable backup.
    #[test]
    fn a_stray_temp_file_is_not_listed_as_a_backup() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("secrets.enc.tmp"), b"partial").unwrap();
        assert!(backup_paths(dir.path(), "secrets.enc").is_empty());
    }
}
