use crate::system_auth::seal::{PlatformSealer, SealOutcome, SealStatus, Sealer};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

pub(crate) const PLAIN: &str = "master_password";
pub(crate) const SEALED: &str = "master_password_sealed";

pub trait Store {
    fn get(&self, key: &str) -> Result<Option<String>, String>;
    fn set(&self, key: &str, value: &str) -> Result<(), String>;
    fn delete(&self, key: &str) -> Result<(), String>;
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum State {
    None,
    Plain,
    Sealed,
}

#[derive(Serialize)]
pub struct Read {
    outcome: SealStatus,
    value: Option<String>,
}

#[derive(Serialize)]
pub struct Exported {
    kind: State,
    value: String,
}

fn read(outcome: SealStatus, value: Option<String>) -> Read {
    Read { outcome, value }
}

pub fn state(store: &impl Store) -> Result<State, String> {
    let sealed = store.get(SEALED)?.is_some();
    let plain = store.get(PLAIN)?.is_some();
    Ok(match (sealed, plain) {
        (true, true) => {
            let _ = store.delete(PLAIN);
            State::Sealed
        }
        (true, false) => State::Sealed,
        (false, true) => State::Plain,
        (false, false) => State::None,
    })
}

async fn seal_to_string(
    sealer: &impl Sealer,
    reason: &str,
    value: &str,
) -> Result<String, SealStatus> {
    match sealer.seal(reason, value.as_bytes()).await {
        SealOutcome::Ok(blob) => Ok(STANDARD.encode(blob)),
        other => Err(SealStatus::from(&other)),
    }
}

pub async fn get(store: &impl Store, sealer: &impl Sealer, reason: &str) -> Read {
    match state(store) {
        Err(_) => read(SealStatus::Failed, None),
        Ok(State::None) => read(SealStatus::None, None),
        Ok(State::Plain) => match store.get(PLAIN) {
            Ok(v) => read(SealStatus::Ok, v),
            Err(_) => read(SealStatus::Failed, None),
        },
        Ok(State::Sealed) => {
            let raw = match store.get(SEALED) {
                Ok(Some(raw)) => raw,
                Ok(None) => return read(SealStatus::None, None),
                Err(_) => return read(SealStatus::Failed, None),
            };
            let Ok(blob) = STANDARD.decode(raw) else {
                let _ = store.delete(SEALED);
                return read(SealStatus::Invalidated, None);
            };
            match sealer.unseal(reason, &blob).await {
                SealOutcome::Ok(pt) => match String::from_utf8(Zeroizing::new(pt).to_vec()) {
                    Ok(v) => read(SealStatus::Ok, Some(v)),
                    Err(_) => read(SealStatus::Failed, None),
                },
                SealOutcome::Invalidated => {
                    let _ = store.delete(SEALED);
                    read(SealStatus::Invalidated, None)
                }
                other => read(SealStatus::from(&other), None),
            }
        }
    }
}

pub async fn set(
    store: &impl Store,
    sealer: &impl Sealer,
    reason: &str,
    value: &str,
) -> SealStatus {
    match state(store) {
        Err(_) => return SealStatus::Failed,
        Ok(State::Sealed) => {}
        Ok(_) => {
            return match store.set(PLAIN, value) {
                Ok(()) => SealStatus::Ok,
                Err(_) => SealStatus::Failed,
            }
        }
    }
    let status = match seal_to_string(sealer, reason, value).await {
        Ok(blob) if store.set(SEALED, &blob).is_ok() => return SealStatus::Ok,
        Ok(_) => SealStatus::Failed,
        Err(status) => status,
    };
    // The sealed copy holds the old password; keep the new one reachable instead.
    match import(store, State::Plain, value) {
        Ok(()) => status,
        Err(_) => SealStatus::Failed,
    }
}

pub async fn bind(
    store: &impl Store,
    sealer: &impl Sealer,
    reason: &str,
    value: &str,
) -> SealStatus {
    if !sealer.available() {
        return SealStatus::Unavailable;
    }
    match seal_to_string(sealer, reason, value).await {
        Ok(blob) => {
            if store.set(SEALED, &blob).is_err() {
                return SealStatus::Failed;
            }
            let _ = store.delete(PLAIN);
            SealStatus::Ok
        }
        Err(status) => status,
    }
}

pub async fn unbind(store: &impl Store, sealer: &impl Sealer, reason: &str) -> SealStatus {
    let r = get(store, sealer, reason).await;
    match (r.outcome, r.value) {
        (SealStatus::Ok, Some(v)) => match import(store, State::Plain, &v) {
            Ok(()) => SealStatus::Ok,
            Err(_) => SealStatus::Failed,
        },
        (outcome, _) => outcome,
    }
}

pub fn clear(store: &impl Store) -> Result<(), String> {
    let plain = store.delete(PLAIN);
    let sealed = store.delete(SEALED);
    plain.and(sealed)
}

pub fn export(store: &impl Store) -> Result<Option<Exported>, String> {
    let kind = state(store)?;
    let key = match kind {
        State::None => return Ok(None),
        State::Plain => PLAIN,
        State::Sealed => SEALED,
    };
    Ok(store.get(key)?.map(|value| Exported { kind, value }))
}

pub fn import(store: &impl Store, kind: State, value: &str) -> Result<(), String> {
    let (write, drop) = match kind {
        State::Plain => (PLAIN, SEALED),
        State::Sealed => (SEALED, PLAIN),
        State::None => return clear(store),
    };
    store.set(write, value)?;
    store.delete(drop)
}

struct Keychain;

// A keychain call can block on an OS prompt (macOS after an update); keep it off the async workers.
fn blocking<T>(job: impl FnOnce() -> T) -> T {
    tokio::task::block_in_place(job)
}

impl Store for Keychain {
    fn get(&self, key: &str) -> Result<Option<String>, String> {
        blocking(|| crate::commands::keychain::read(key).map_err(|e| e.to_string()))
    }
    fn set(&self, key: &str, value: &str) -> Result<(), String> {
        blocking(|| {
            crate::commands::keychain::entry(key)
                .and_then(|e| e.set_password(value))
                .map_err(|e| e.to_string())
        })
    }
    fn delete(&self, key: &str) -> Result<(), String> {
        blocking(|| {
            match crate::commands::keychain::entry(key).and_then(|e| e.delete_credential()) {
                Ok(()) | Err(keyring_core::Error::NoEntry) => Ok(()),
                Err(e) => Err(e.to_string()),
            }
        })
    }
}

#[tauri::command]
pub async fn vault_secret_state() -> Result<State, String> {
    state(&Keychain)
}

#[tauri::command]
pub async fn vault_secret_seal_available() -> bool {
    blocking(|| PlatformSealer.available())
}

#[tauri::command]
pub async fn vault_secret_get(reason: String) -> Read {
    get(&Keychain, &PlatformSealer, &reason).await
}

#[tauri::command]
pub async fn vault_secret_set(value: String, reason: String) -> SealStatus {
    set(&Keychain, &PlatformSealer, &reason, &value).await
}

#[tauri::command]
pub async fn vault_secret_bind(value: String, reason: String) -> SealStatus {
    bind(&Keychain, &PlatformSealer, &reason, &value).await
}

#[tauri::command]
pub async fn vault_secret_unbind(reason: String) -> SealStatus {
    unbind(&Keychain, &PlatformSealer, &reason).await
}

#[tauri::command]
pub async fn vault_secret_clear() -> Result<(), String> {
    clear(&Keychain)
}

#[tauri::command]
pub async fn vault_secret_export() -> Result<Option<Exported>, String> {
    export(&Keychain)
}

#[tauri::command]
pub async fn vault_secret_import(kind: State, value: String) -> Result<(), String> {
    import(&Keychain, kind, &value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    #[derive(Default)]
    struct MemStore {
        map: RefCell<HashMap<String, String>>,
        failing_get: RefCell<Option<&'static str>>,
        failing_delete: RefCell<Option<&'static str>>,
    }

    impl MemStore {
        fn fail_get(&self, k: &'static str) {
            *self.failing_get.borrow_mut() = Some(k);
        }
        fn fail_delete(&self, k: &'static str) {
            *self.failing_delete.borrow_mut() = Some(k);
        }
        fn raw(&self, k: &str) -> Option<String> {
            self.map.borrow().get(k).cloned()
        }
    }

    impl Store for MemStore {
        fn get(&self, k: &str) -> Result<Option<String>, String> {
            if *self.failing_get.borrow() == Some(k) {
                return Err("keychain busy".into());
            }
            Ok(self.map.borrow().get(k).cloned())
        }
        fn set(&self, k: &str, v: &str) -> Result<(), String> {
            self.map.borrow_mut().insert(k.into(), v.into());
            Ok(())
        }
        fn delete(&self, k: &str) -> Result<(), String> {
            if *self.failing_delete.borrow() == Some(k) {
                return Err("keychain busy".into());
            }
            self.map.borrow_mut().remove(k);
            Ok(())
        }
    }

    #[derive(Clone, Copy)]
    enum Behaviour {
        Works,
        Cancels,
        Invalidated,
    }

    struct FakeSealer(Behaviour);

    impl Sealer for FakeSealer {
        fn available(&self) -> bool {
            true
        }
        async fn seal(&self, _r: &str, pt: &[u8]) -> SealOutcome {
            match self.0 {
                Behaviour::Works => SealOutcome::Ok([b"S:".as_slice(), pt].concat()),
                Behaviour::Cancels => SealOutcome::Cancelled,
                Behaviour::Invalidated => SealOutcome::Invalidated,
            }
        }
        async fn unseal(&self, _r: &str, blob: &[u8]) -> SealOutcome {
            match self.0 {
                Behaviour::Works => SealOutcome::Ok(blob[2..].to_vec()),
                Behaviour::Cancels => SealOutcome::Cancelled,
                Behaviour::Invalidated => SealOutcome::Invalidated,
            }
        }
    }

    fn run<F: std::future::Future>(f: F) -> F::Output {
        tauri::async_runtime::block_on(f)
    }

    const W: FakeSealer = FakeSealer(Behaviour::Works);
    const C: FakeSealer = FakeSealer(Behaviour::Cancels);
    const I: FakeSealer = FakeSealer(Behaviour::Invalidated);

    #[test]
    fn plain_reads_without_prompting() {
        let s = MemStore::default();
        s.set(PLAIN, "pw").unwrap();
        let r = run(get(&s, &C, "r"));
        assert_eq!(
            (r.outcome, r.value.as_deref()),
            (SealStatus::Ok, Some("pw"))
        );
    }

    #[test]
    fn nothing_stored_reads_as_none() {
        let r = run(get(&MemStore::default(), &W, "r"));
        assert_eq!((r.outcome, r.value), (SealStatus::None, None));
    }

    #[test]
    fn bind_replaces_the_plain_entry() {
        let s = MemStore::default();
        s.set(PLAIN, "pw").unwrap();
        assert_eq!(run(bind(&s, &W, "r", "pw")), SealStatus::Ok);
        assert_eq!(state(&s), Ok(State::Sealed));
        assert_eq!(s.get(PLAIN).unwrap(), None);
        assert_eq!(run(get(&s, &W, "r")).value.as_deref(), Some("pw"));
    }

    #[test]
    fn a_cancelled_bind_keeps_the_plain_entry() {
        let s = MemStore::default();
        s.set(PLAIN, "pw").unwrap();
        assert_eq!(run(bind(&s, &C, "r", "pw")), SealStatus::Cancelled);
        assert_eq!(state(&s), Ok(State::Plain));
    }

    #[test]
    fn an_invalidated_unseal_drops_the_sealed_entry() {
        let s = MemStore::default();
        run(bind(&s, &W, "r", "pw"));
        assert_eq!(run(get(&s, &I, "r")).outcome, SealStatus::Invalidated);
        assert_eq!(state(&s), Ok(State::None));
    }

    #[test]
    fn an_unreadable_blob_reads_as_invalidated() {
        let s = MemStore::default();
        s.set(SEALED, "not base64!").unwrap();
        assert_eq!(run(get(&s, &W, "r")).outcome, SealStatus::Invalidated);
        assert_eq!(state(&s), Ok(State::None));
    }

    #[test]
    fn a_cancelled_unseal_keeps_the_sealed_entry() {
        let s = MemStore::default();
        run(bind(&s, &W, "r", "pw"));
        assert_eq!(run(get(&s, &C, "r")).outcome, SealStatus::Cancelled);
        assert_eq!(state(&s), Ok(State::Sealed));
    }

    #[test]
    fn set_seals_when_bound_and_writes_plain_otherwise() {
        let s = MemStore::default();
        assert_eq!(run(set(&s, &W, "r", "a")), SealStatus::Ok);
        assert_eq!(s.get(PLAIN).unwrap().as_deref(), Some("a"));
        run(bind(&s, &W, "r", "a"));
        assert_eq!(run(set(&s, &W, "r", "b")), SealStatus::Ok);
        assert_eq!(run(get(&s, &W, "r")).value.as_deref(), Some("b"));
        assert_eq!(s.get(PLAIN).unwrap(), None);
    }

    #[test]
    fn a_failed_reseal_keeps_the_new_password_in_plain() {
        let s = MemStore::default();
        run(bind(&s, &W, "r", "a"));
        assert_eq!(run(set(&s, &C, "r", "b")), SealStatus::Cancelled);
        assert_eq!(state(&s), Ok(State::Plain));
        assert_eq!(s.raw(PLAIN).as_deref(), Some("b"));
    }

    #[test]
    fn a_keychain_read_error_keeps_the_sealed_entry() {
        let s = MemStore::default();
        run(bind(&s, &W, "r", "pw"));
        s.fail_get(SEALED);
        assert_eq!(run(get(&s, &W, "r")).outcome, SealStatus::Failed);
        assert!(s.raw(SEALED).is_some());
    }

    #[test]
    fn state_reports_a_keychain_read_error() {
        let s = MemStore::default();
        run(bind(&s, &W, "r", "pw"));
        s.fail_get(SEALED);
        assert!(state(&s).is_err());
    }

    #[test]
    fn set_writes_nothing_when_the_state_cannot_be_read() {
        let s = MemStore::default();
        run(bind(&s, &W, "r", "old"));
        s.fail_get(SEALED);
        assert_eq!(run(set(&s, &W, "r", "new")), SealStatus::Failed);
        assert_eq!(s.raw(PLAIN), None);
    }

    #[test]
    fn clear_still_removes_the_sealed_entry_when_the_plain_delete_fails() {
        let s = MemStore::default();
        s.set(PLAIN, "a").unwrap();
        s.set(SEALED, "b").unwrap();
        s.fail_delete(PLAIN);
        assert!(clear(&s).is_err());
        assert_eq!(s.raw(SEALED), None);
    }

    #[test]
    fn unbind_restores_the_plain_entry() {
        let s = MemStore::default();
        run(bind(&s, &W, "r", "pw"));
        assert_eq!(run(unbind(&s, &W, "r")), SealStatus::Ok);
        assert_eq!(s.get(PLAIN).unwrap().as_deref(), Some("pw"));
        assert_eq!(s.get(SEALED).unwrap(), None);
    }

    #[test]
    fn state_heals_a_leftover_plain_entry() {
        let s = MemStore::default();
        run(bind(&s, &W, "r", "pw"));
        s.set(PLAIN, "pw").unwrap();
        assert_eq!(state(&s), Ok(State::Sealed));
        assert_eq!(s.get(PLAIN).unwrap(), None);
    }

    #[test]
    fn export_and_import_copy_the_stored_form() {
        let s = MemStore::default();
        run(bind(&s, &W, "r", "pw"));
        let e = export(&s).unwrap().unwrap();
        assert_eq!(e.kind, State::Sealed);
        let t = MemStore::default();
        t.set(PLAIN, "old").unwrap();
        import(&t, e.kind, &e.value).unwrap();
        assert_eq!(state(&t), Ok(State::Sealed));
        assert_eq!(run(get(&t, &W, "r")).value.as_deref(), Some("pw"));
    }

    #[test]
    fn clear_removes_both() {
        let s = MemStore::default();
        s.set(PLAIN, "a").unwrap();
        s.set(SEALED, "b").unwrap();
        clear(&s).unwrap();
        assert_eq!(state(&s), Ok(State::None));
    }

    #[test]
    fn the_raw_keychain_commands_refuse_reserved_names() {
        assert!(crate::commands::keychain::guard(PLAIN).is_err());
        assert!(crate::commands::keychain::guard(SEALED).is_err());
        assert!(crate::commands::keychain::guard("jwt").is_ok());
    }
}
