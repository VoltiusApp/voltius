//! One keychain item per service: without an Apple-issued certificate, macOS keys each
//! item's partition list to the build's cdhash, so every update prompts once per item.

use std::any::Any;
use std::collections::hash_map::Entry as Slot;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, PoisonError};

use base64::{engine::general_purpose::STANDARD, Engine};
use keyring_core::api::{CredentialApi, CredentialPersistence, CredentialStoreApi};
use keyring_core::{Credential, CredentialStore, Entry, Error, Result};

const BUNDLE_USER: &str = "__bundle__";

/// `None` is a tombstone: the key was deleted or has no legacy item, so the legacy
/// item must never be consulted again.
type Bundle = BTreeMap<String, Option<String>>;

struct Shared {
    inner: Arc<CredentialStore>,
    bundles: Mutex<HashMap<String, Bundle>>,
}

impl Shared {
    fn inner_entry(&self, service: &str, user: &str) -> Result<Entry> {
        self.inner.build(service, user, None)
    }

    fn load(&self, service: &str) -> Result<Bundle> {
        match self.inner_entry(service, BUNDLE_USER)?.get_secret() {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| Error::BadDataFormat(bytes, e.to_string().into())),
            Err(Error::NoEntry) => Ok(Bundle::new()),
            Err(e) => Err(e),
        }
    }

    fn persist(&self, service: &str, bundle: &Bundle) -> Result<()> {
        let json = serde_json::to_vec(bundle).map_err(|e| Error::PlatformFailure(e.into()))?;
        self.inner_entry(service, BUNDLE_USER)?.set_secret(&json)
    }

    /// Deletion needs a read on macOS, so this can prompt; a failure only leaves a
    /// stale item that the bundle shadows.
    fn retire_legacy(&self, service: &str, user: &str) -> Result<()> {
        let result = self.inner_entry(service, user)?.delete_credential();
        if let Err(e) = &result {
            if !matches!(e, Error::NoEntry) {
                log::warn!("could not delete legacy keychain item {service}/{user}: {e}");
            }
        }
        result
    }

    fn with_bundle<R>(
        &self,
        service: &str,
        op: impl FnOnce(&Self, &mut Bundle) -> Result<R>,
    ) -> Result<R> {
        let mut bundles = self.bundles.lock().unwrap_or_else(PoisonError::into_inner);
        let bundle = match bundles.entry(service.to_string()) {
            Slot::Occupied(slot) => slot.into_mut(),
            Slot::Vacant(slot) => slot.insert(self.load(service)?),
        };
        op(self, bundle)
    }
}

fn decode(stored: &str) -> Result<Vec<u8>> {
    STANDARD
        .decode(stored)
        .map_err(|e| Error::BadDataFormat(stored.as_bytes().to_vec(), e.to_string().into()))
}

#[derive(Debug)]
struct BundledCred {
    service: String,
    user: String,
    shared: Arc<Shared>,
}

impl BundledCred {
    /// Writes `value` for this key, persisting before touching the cache so a failed
    /// write leaves memory matching the keychain.
    fn write(&self, shared: &Shared, bundle: &mut Bundle, value: Option<String>) -> Result<()> {
        let mut next = bundle.clone();
        next.insert(self.user.clone(), value);
        shared.persist(&self.service, &next)?;
        *bundle = next;
        Ok(())
    }
}

impl CredentialApi for BundledCred {
    fn set_secret(&self, secret: &[u8]) -> Result<()> {
        self.shared.with_bundle(&self.service, |shared, bundle| {
            let had_record = bundle.contains_key(&self.user);
            self.write(shared, bundle, Some(STANDARD.encode(secret)))?;
            if !had_record {
                let _ = shared.retire_legacy(&self.service, &self.user);
            }
            Ok(())
        })
    }

    fn get_secret(&self) -> Result<Vec<u8>> {
        self.shared.with_bundle(&self.service, |shared, bundle| {
            match bundle.get(&self.user) {
                Some(Some(stored)) => return decode(stored),
                Some(None) => return Err(Error::NoEntry),
                None => {}
            }
            match shared.inner_entry(&self.service, &self.user)?.get_secret() {
                Ok(secret) => {
                    match self.write(shared, bundle, Some(STANDARD.encode(&secret))) {
                        Ok(()) => {
                            let _ = shared.retire_legacy(&self.service, &self.user);
                        }
                        Err(e) => log::warn!(
                            "could not move keychain item {}/{} into the bundle: {e}",
                            self.service,
                            self.user
                        ),
                    }
                    Ok(secret)
                }
                Err(Error::NoEntry) => {
                    bundle.insert(self.user.clone(), None);
                    Err(Error::NoEntry)
                }
                Err(e) => Err(e),
            }
        })
    }

    fn delete_credential(&self) -> Result<()> {
        self.shared.with_bundle(&self.service, |shared, bundle| {
            match bundle.get(&self.user) {
                Some(None) => Err(Error::NoEntry),
                Some(Some(_)) => self.write(shared, bundle, None),
                None => {
                    self.write(shared, bundle, None)?;
                    match shared.retire_legacy(&self.service, &self.user) {
                        Err(Error::NoEntry) => Err(Error::NoEntry),
                        _ => Ok(()),
                    }
                }
            }
        })
    }

    fn get_credential(&self) -> Result<Option<Arc<Credential>>> {
        self.get_secret().map(|_| None)
    }

    fn get_specifiers(&self) -> Option<(String, String)> {
        Some((self.service.clone(), self.user.clone()))
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}

impl std::fmt::Debug for Shared {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Shared")
            .field("inner", &self.inner.id())
            .finish()
    }
}

/// Bundles services for which `bundled` holds; every other service (another app's
/// items, such as the Termius import) passes through to `inner` untouched.
#[derive(Debug)]
pub struct Store {
    shared: Arc<Shared>,
    bundled: fn(&str) -> bool,
}

impl Store {
    pub fn new(inner: Arc<CredentialStore>, bundled: fn(&str) -> bool) -> Arc<Self> {
        Arc::new(Store {
            shared: Arc::new(Shared {
                inner,
                bundles: Mutex::new(HashMap::new()),
            }),
            bundled,
        })
    }
}

impl CredentialStoreApi for Store {
    fn vendor(&self) -> String {
        format!(
            "Voltius single-item bundle over {}",
            self.shared.inner.vendor()
        )
    }

    fn id(&self) -> String {
        format!("voltius-keychain-bundle v{}", env!("CARGO_PKG_VERSION"))
    }

    fn build(
        &self,
        service: &str,
        user: &str,
        modifiers: Option<&HashMap<&str, &str>>,
    ) -> Result<Entry> {
        if !(self.bundled)(service) {
            return self.shared.inner.build(service, user, modifiers);
        }
        if modifiers.is_some_and(|m| !m.is_empty()) {
            return Err(Error::NotSupportedByStore(
                "This store does not allow entry modifiers".to_string(),
            ));
        }
        if user == BUNDLE_USER {
            return Err(Error::Invalid(user.to_string(), "reserved".to_string()));
        }
        Ok(Entry::new_with_credential(Arc::new(BundledCred {
            service: service.to_string(),
            user: user.to_string(),
            shared: self.shared.clone(),
        })))
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn persistence(&self) -> CredentialPersistence {
        self.shared.inner.persistence()
    }

    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use keyring_core::mock;

    const SVC: &str = "voltius";

    struct Fixture {
        inner: Arc<CredentialStore>,
        store: Arc<Store>,
    }

    fn fixture() -> Fixture {
        let inner: Arc<CredentialStore> = mock::Store::new().unwrap();
        let store = Store::new(inner.clone(), |s| s.starts_with("voltius"));
        Fixture { inner, store }
    }

    impl Fixture {
        fn entry(&self, user: &str) -> Entry {
            self.store.build(SVC, user, None).unwrap()
        }

        fn legacy(&self, user: &str) -> Entry {
            self.inner.build(SVC, user, None).unwrap()
        }

        /// A second process launch: same keychain, cold cache.
        fn relaunch(&self) -> Arc<Store> {
            Store::new(self.inner.clone(), |s| s.starts_with("voltius"))
        }

        fn fail_next(&self, user: &str, err: Error) {
            let entry = self.legacy(user);
            let cred: &mock::Cred = entry.as_any().downcast_ref().unwrap();
            cred.set_error(err);
        }

        fn stored(&self) -> Bundle {
            serde_json::from_slice(&self.legacy(BUNDLE_USER).get_secret().unwrap()).unwrap()
        }
    }

    fn denied() -> Error {
        Error::NoStorageAccess("user denied".into())
    }

    #[test]
    fn set_then_get_round_trips_through_one_item() {
        let f = fixture();
        f.entry("jwt").set_password("token").unwrap();
        f.entry("mode").set_password("server").unwrap();
        assert_eq!(f.entry("jwt").get_password().unwrap(), "token");
        assert!(matches!(f.legacy("jwt").get_secret(), Err(Error::NoEntry)));
        let relaunched = f.relaunch().build(SVC, "mode", None).unwrap();
        assert_eq!(relaunched.get_password().unwrap(), "server");
    }

    #[test]
    fn legacy_item_migrates_on_first_read_then_is_deleted() {
        let f = fixture();
        f.legacy("master_password").set_password("hunter2").unwrap();
        assert_eq!(
            f.entry("master_password").get_password().unwrap(),
            "hunter2"
        );
        assert!(matches!(
            f.legacy("master_password").get_secret(),
            Err(Error::NoEntry)
        ));
        assert_eq!(
            f.stored()["master_password"]
                .as_deref()
                .map(decode)
                .unwrap()
                .unwrap(),
            b"hunter2"
        );
    }

    #[test]
    fn denied_legacy_read_keeps_the_item_and_retries_later() {
        let f = fixture();
        f.legacy("account_id").set_password("acc").unwrap();
        f.fail_next("account_id", denied());
        assert!(matches!(
            f.entry("account_id").get_password(),
            Err(Error::NoStorageAccess(_))
        ));
        assert_eq!(f.legacy("account_id").get_password().unwrap(), "acc");
        assert_eq!(f.entry("account_id").get_password().unwrap(), "acc");
    }

    #[test]
    fn deleted_key_never_resurrects_from_a_legacy_item_that_survived() {
        let f = fixture();
        f.legacy("master_password").set_password("old").unwrap();
        f.fail_next("master_password", denied());
        f.entry("master_password").delete_credential().unwrap();
        assert_eq!(f.legacy("master_password").get_password().unwrap(), "old");
        let relaunched = f.relaunch().build(SVC, "master_password", None).unwrap();
        assert!(matches!(relaunched.get_password(), Err(Error::NoEntry)));
    }

    #[test]
    fn delete_reports_no_entry_only_when_nothing_existed() {
        let f = fixture();
        assert!(matches!(
            f.entry("email").delete_credential(),
            Err(Error::NoEntry)
        ));
        f.entry("email").set_password("a@b").unwrap();
        f.entry("email").delete_credential().unwrap();
        assert!(matches!(
            f.entry("email").get_password(),
            Err(Error::NoEntry)
        ));
        assert!(matches!(
            f.entry("email").delete_credential(),
            Err(Error::NoEntry)
        ));
    }

    #[test]
    fn unreadable_bundle_fails_closed_and_is_never_overwritten() {
        let f = fixture();
        f.entry("jwt").set_password("token").unwrap();
        let relaunched = f.relaunch();
        f.fail_next(BUNDLE_USER, denied());
        let jwt = relaunched.build(SVC, "jwt", None).unwrap();
        assert!(matches!(
            jwt.set_password("other"),
            Err(Error::NoStorageAccess(_))
        ));
        assert_eq!(jwt.get_password().unwrap(), "token");
    }

    #[test]
    fn corrupt_bundle_is_an_error_not_an_empty_store() {
        let f = fixture();
        f.legacy(BUNDLE_USER).set_password("not json").unwrap();
        assert!(matches!(
            f.entry("jwt").get_password(),
            Err(Error::BadDataFormat(..))
        ));
        assert!(f.entry("jwt").set_password("x").is_err());
        assert_eq!(f.legacy(BUNDLE_USER).get_password().unwrap(), "not json");
    }

    #[test]
    fn failed_write_leaves_the_cache_unchanged() {
        let f = fixture();
        f.entry("jwt").set_password("token").unwrap();
        f.fail_next(BUNDLE_USER, denied());
        assert!(f.entry("jwt").set_password("other").is_err());
        assert_eq!(f.entry("jwt").get_password().unwrap(), "token");
    }

    #[test]
    fn legacy_value_is_returned_even_when_the_bundle_cannot_be_written() {
        let f = fixture();
        f.legacy("jwt").set_password("token").unwrap();
        f.entry("mode").get_password().unwrap_err();
        f.fail_next(BUNDLE_USER, denied());
        assert_eq!(f.entry("jwt").get_password().unwrap(), "token");
        assert_eq!(f.legacy("jwt").get_password().unwrap(), "token");
    }

    #[test]
    fn other_services_pass_through_untouched() {
        let f = fixture();
        f.inner
            .build("Termius", "localKey", None)
            .unwrap()
            .set_password("k")
            .unwrap();
        let entry = f.store.build("Termius", "localKey", None).unwrap();
        assert_eq!(entry.get_password().unwrap(), "k");
        assert!(matches!(
            f.legacy(BUNDLE_USER).get_secret(),
            Err(Error::NoEntry)
        ));
    }

    #[test]
    fn namespaced_services_get_separate_bundles() {
        let f = fixture();
        f.entry("jwt").set_password("a").unwrap();
        f.store
            .build("voltius-2", "jwt", None)
            .unwrap()
            .set_password("b")
            .unwrap();
        assert_eq!(f.entry("jwt").get_password().unwrap(), "a");
        assert_eq!(
            f.store
                .build("voltius-2", "jwt", None)
                .unwrap()
                .get_password()
                .unwrap(),
            "b"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "writes to the login keychain"]
    fn real_macos_keychain_migrates_and_round_trips() {
        let svc = format!("voltius-bundle-test-{}", std::process::id());
        let inner: Arc<CredentialStore> =
            apple_native_keyring_store::keychain::Store::new().unwrap();
        let legacy = |user: &str| inner.build(&svc, user, None).unwrap();
        let store = Store::new(inner.clone(), |s| s.starts_with("voltius-bundle-test-"));
        let entry = |user: &str| store.build(&svc, user, None).unwrap();

        legacy("master_password").set_password("hunter2").unwrap();
        assert_eq!(entry("master_password").get_password().unwrap(), "hunter2");
        assert!(matches!(
            legacy("master_password").get_secret(),
            Err(Error::NoEntry)
        ));
        assert!(matches!(
            entry("missing").get_password(),
            Err(Error::NoEntry)
        ));
        entry("jwt").set_password("token").unwrap();
        entry("jwt").set_password("token2").unwrap();
        let relaunched = Store::new(inner.clone(), |s| s.starts_with("voltius-bundle-test-"));
        let jwt = relaunched.build(&svc, "jwt", None).unwrap();
        assert_eq!(jwt.get_password().unwrap(), "token2");
        jwt.delete_credential().unwrap();
        assert!(matches!(jwt.get_password(), Err(Error::NoEntry)));

        legacy(BUNDLE_USER).delete_credential().unwrap();
    }

    #[test]
    fn reserved_user_is_rejected() {
        let f = fixture();
        assert!(f.store.build(SVC, BUNDLE_USER, None).is_err());
    }
}
