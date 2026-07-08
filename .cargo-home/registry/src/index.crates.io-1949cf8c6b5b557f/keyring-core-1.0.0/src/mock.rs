/*!

# Mock credential store

To facilitate testing of clients, this crate provides a Mock credential store
that is platform-independent, provides no persistence, and allows the client
to specify the return values (including errors) for each call. The credentials
in this store have no attributes at all.

To use this credential store instead of the default, make this call during
application startup _before_ creating any entries:
```rust
keyring_core::set_default_store(keyring_core::mock::Store::new().unwrap());
```

You can then create entries as usual and call their usual methods
to set, get, and delete passwords. There is no persistence except in-memory
so, once you drop the store, all the credentials will be gone.

If you want a method call on an entry to fail in a specific way, you can
downcast the entry to a [Cred] and then call [set_error](Cred::set_error)
with the appropriate error.  The next entry method called on the credential
will fail with the error you set.  The error will then be cleared, so the next
call on the mock will operate as usual.  Setting an error will not affect
the value of the credential (if any). Here's a complete example:

```rust
# use keyring_core::{Entry, Error, mock};
keyring_core::set_default_store(mock::Store::new().unwrap());
let entry = Entry::new("service", "user").unwrap();
entry.set_password("test").expect("the entry's password is now test");
let mock: &mock::Cred = entry.as_any().downcast_ref().unwrap();
mock.set_error(Error::Invalid("mock error".to_string(), "takes precedence".to_string()));
_ = entry.get_password().expect_err("the error will be returned");
let val = entry.get_password().expect("the error has been cleared");
assert_eq!(val, "test", "the error did not affect the password");
```

 */
use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::api::{CredentialApi, CredentialStoreApi};
use crate::{Credential, CredentialPersistence, Entry, Error, Result};

/// The concrete mock credential
///
/// Mocks use an internal mutability pattern since entries are read-only.
/// The mutex is used to make sure these are Sync.
#[derive(Debug)]
pub struct Cred {
    pub specifiers: (String, String),
    pub inner: Mutex<RefCell<CredData>>,
}

/// The (in-memory) persisted data for a mock credential.
///
/// We keep a password but, unlike most credentials stores,
/// we also keep an intended error to return on the next call.
///
/// (Everything about this structure is public for transparency.
/// Most credential store implementations hide their internals.)
#[derive(Debug, Default)]
pub struct CredData {
    pub secret: Option<Vec<u8>>,
    pub error: Option<Error>,
}

impl CredentialApi for Cred {
    /// See the API docs.
    ///
    /// If there is an error in the mock, it will be returned
    /// and the secret will _not_ be set.  The error will
    /// be cleared, so calling again will set the secret.
    fn set_secret(&self, secret: &[u8]) -> Result<()> {
        let mut inner = self
            .inner
            .lock()
            .expect("Can't access mock data for set_secret: please report a bug!");
        let data = inner.get_mut();
        let err = data.error.take();
        match err {
            None => {
                data.secret = Some(secret.to_vec());
                Ok(())
            }
            Some(err) => Err(err),
        }
    }

    /// See the API docs.
    ///
    /// If there is an error set in the mock, it will
    /// be returned instead of a secret. The existing
    /// secret will not change.
    fn get_secret(&self) -> Result<Vec<u8>> {
        let mut inner = self
            .inner
            .lock()
            .expect("Can't access mock data for get: please report a bug!");
        let data = inner.get_mut();
        let err = data.error.take();
        match err {
            None => match &data.secret {
                None => Err(Error::NoEntry),
                Some(val) => Ok(val.clone()),
            },
            Some(err) => Err(err),
        }
    }

    /// See the API docs.
    ///
    /// If there is an error, it will be returned and
    /// cleared. Calling again will delete the cred.
    fn delete_credential(&self) -> Result<()> {
        let mut inner = self
            .inner
            .lock()
            .expect("Can't access mock data for delete: please report a bug!");
        let data = inner.get_mut();
        let err = data.error.take();
        match err {
            None => match data.secret {
                Some(_) => {
                    data.secret = None;
                    Ok(())
                }
                None => Err(Error::NoEntry),
            },
            Some(err) => Err(err),
        }
    }

    /// See the API docs.
    ///
    /// If there is an error in the mock, it's returned instead and cleared.
    /// Calling again will retry the operation.
    fn get_credential(&self) -> Result<Option<Arc<Credential>>> {
        let mut inner = self
            .inner
            .lock()
            .expect("Can't access mock data for get_credential: please report a bug!");
        let data = inner.get_mut();
        let err = data.error.take();
        match err {
            None => match data.secret {
                Some(_) => Ok(None),
                None => Err(Error::NoEntry),
            },
            Some(err) => Err(err),
        }
    }

    /// See the API docs.
    fn get_specifiers(&self) -> Option<(String, String)> {
        Some(self.specifiers.clone())
    }

    /// Return this mock credential concrete object
    /// wrapped in the [Any](std::any::Any) trait,
    /// so it can be downcast.
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    /// Expose the concrete debug formatter for use via the [Credential] trait
    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}

impl Cred {
    /// Set an error to be returned from this mock credential.
    ///
    /// Error returns always take precedence over the normal
    /// behavior of the mock.  But once an error has been
    /// returned, it is removed, so the mock works thereafter.
    pub fn set_error(&self, err: Error) {
        let mut inner = self
            .inner
            .lock()
            .expect("Can't access mock data for set_error: please report a bug!");
        let data = inner.get_mut();
        data.error = Some(err);
    }
}

/// The builder for mock credentials.
///
/// We keep them in a vector so we can reuse them
/// for entries with the same service and user.
/// Yes, a hashmap might be faster, but this is
/// way simpler.
pub struct Store {
    pub id: String,
    pub inner: Mutex<RefCell<Vec<Arc<Cred>>>>,
}

impl std::fmt::Debug for Store {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Store")
            .field("vendor", &self.vendor())
            .field("id", &self.id)
            .finish()
    }
}

impl Store {
    pub fn new() -> Result<Arc<Self>> {
        Ok(Arc::new(Store {
            id: format!(
                "Crate version {}, Instantiated at {}",
                env!("CARGO_PKG_VERSION"),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_else(|_| Duration::new(0, 0))
                    .as_secs_f64()
            ),
            inner: Mutex::new(RefCell::new(Vec::new())),
        }))
    }
}

impl CredentialStoreApi for Store {
    fn vendor(&self) -> String {
        String::from("Mock store, https://crates.io/crates/keyring-core")
    }

    fn id(&self) -> String {
        self.id.clone()
    }

    /// Build a mock credential for the service and user. No modifiers are allowed.
    ///
    /// Since mocks don't persist beyond the life of their entry, all mocks
    /// start off without passwords.
    fn build(
        &self,
        service: &str,
        user: &str,
        mods: Option<&HashMap<&str, &str>>,
    ) -> Result<Entry> {
        if mods.is_some_and(|m| !m.is_empty()) {
            let msg = "The mock store doesn't allow entry modifiers";
            return Err(Error::NotSupportedByStore(msg.to_string()));
        }
        let mut inner = self
            .inner
            .lock()
            .expect("Can't access mock store data: please report a bug!");
        let creds = inner.get_mut();
        for cred in creds.iter() {
            if service == cred.specifiers.0 && user == cred.specifiers.1 {
                return Ok(Entry {
                    inner: cred.clone(),
                });
            }
        }
        let cred = Arc::new(Cred {
            specifiers: (service.to_string(), user.to_string()),
            inner: Mutex::new(RefCell::new(Default::default())),
        });
        creds.push(cred.clone());
        Ok(Entry { inner: cred })
    }

    /// Search for mock credentials matching the spec.
    ///
    /// Attributes other than `service` and `user` are ignored.
    /// Their values are used in unanchored substring searches against the specifier.
    fn search(&self, spec: &HashMap<&str, &str>) -> Result<Vec<Entry>> {
        let mut result: Vec<Entry> = Vec::new();
        let svc = spec.get("service").unwrap_or(&"");
        let usr = spec.get("user").unwrap_or(&"");
        let mut inner = self
            .inner
            .lock()
            .expect("Can't access mock store data: please report a bug!");
        let creds = inner.get_mut();
        for cred in creds.iter() {
            if !cred.specifiers.0.as_str().contains(svc) {
                continue;
            }
            if !cred.specifiers.1.as_str().contains(usr) {
                continue;
            }
            result.push(Entry {
                inner: cred.clone(),
            });
        }
        Ok(result)
    }

    /// Get an [Any][std::any::Any] reference to the mock credential builder.
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    /// This keystore keeps the password in the entry!
    fn persistence(&self) -> CredentialPersistence {
        CredentialPersistence::ProcessOnly
    }

    /// Expose the concrete debug formatter
    /// for use via the [CredentialStore](crate::CredentialStore) trait
    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Once};

    use super::{Cred, HashMap, Store};
    use crate::{CredentialPersistence, CredentialStore, Entry, Error, get_default_store};

    static SET_STORE: Once = Once::new();

    fn usually_goes_in_main() {
        let _ = env_logger::builder().is_test(true).try_init();
        crate::set_default_store(Store::new().unwrap());
    }

    #[test]
    fn test_store_methods() {
        SET_STORE.call_once(usually_goes_in_main);
        let store = get_default_store().unwrap();
        let vendor1 = store.vendor();
        let id1 = store.id();
        let vendor2 = store.vendor();
        let id2 = store.id();
        assert_eq!(vendor1, vendor2);
        assert_eq!(id1, id2);
        let store2: Arc<CredentialStore> = Store::new().unwrap();
        let vendor3 = store2.vendor();
        let id3 = store2.id();
        assert_eq!(vendor1, vendor3);
        assert_ne!(id1, id3);
    }

    fn entry_new(service: &str, user: &str) -> Entry {
        SET_STORE.call_once(usually_goes_in_main);
        Entry::new(service, user).unwrap_or_else(|err| {
            panic!("Couldn't create entry (service: {service}, user: {user}): {err:?}")
        })
    }

    fn generate_random_string() -> String {
        use fastrand;
        use std::iter::repeat_with;
        repeat_with(fastrand::alphanumeric).take(30).collect()
    }

    fn generate_random_bytes() -> Vec<u8> {
        use fastrand;
        use std::iter::repeat_with;
        repeat_with(|| fastrand::u8(..)).take(24).collect()
    }

    // A round-trip password test that doesn't delete the credential afterward
    fn test_round_trip_no_delete(case: &str, entry: &Entry, in_pass: &str) {
        entry
            .set_password(in_pass)
            .unwrap_or_else(|err| panic!("Can't set password: {case}: {err:?}"));
        let out_pass = entry
            .get_password()
            .unwrap_or_else(|err| panic!("Can't get password: {case}: {err:?}"));
        assert_eq!(
            in_pass, out_pass,
            "Passwords don't match for {case}: set='{in_pass}', get='{out_pass}'",
        )
    }

    // A round-trip password test that does delete the credential afterward
    fn test_round_trip(case: &str, entry: &Entry, in_pass: &str) {
        test_round_trip_no_delete(case, entry, in_pass);
        entry
            .delete_credential()
            .unwrap_or_else(|err| panic!("Can't delete password: {case}: {err:?}"));
        let password = entry.get_password();
        assert!(matches!(password, Err(Error::NoEntry)));
    }

    // A round-trip secret test that does delete the credential afterward
    pub fn test_round_trip_secret(case: &str, entry: &Entry, in_secret: &[u8]) {
        entry
            .set_secret(in_secret)
            .unwrap_or_else(|err| panic!("Can't set secret for {case}: {err:?}"));
        let out_secret = entry
            .get_secret()
            .unwrap_or_else(|err| panic!("Can't get secret for {case}: {err:?}"));
        assert_eq!(
            in_secret, &out_secret,
            "Secrets don't match for {case}: set='{in_secret:?}', get='{out_secret:?}'",
        );
        entry
            .delete_credential()
            .unwrap_or_else(|err| panic!("Can't delete credential for {case}: {err:?}"));
        let secret = entry.get_secret();
        assert!(matches!(secret, Err(Error::NoEntry)));
    }

    #[test]
    fn test_empty_service_and_user() {
        let name = generate_random_string();
        let in_pass = "value doesn't matter";
        test_round_trip("empty user", &entry_new(&name, ""), in_pass);
        test_round_trip("empty service", &entry_new("", &name), in_pass);
        test_round_trip("empty service and user", &entry_new("", ""), in_pass);
    }

    #[test]
    fn test_empty_password() {
        let name = generate_random_string();
        let in_pass = "";
        test_round_trip("empty password", &entry_new(&name, &name), in_pass);
    }

    #[test]
    fn test_missing_entry() {
        let name = generate_random_string();
        let entry = entry_new(&name, &name);
        assert!(matches!(entry.get_password(), Err(Error::NoEntry)))
    }

    #[test]
    fn test_round_trip_ascii_password() {
        let name = generate_random_string();
        let entry = entry_new(&name, &name);
        test_round_trip("ascii password", &entry, "test ascii password");
    }

    #[test]
    fn test_round_trip_non_ascii_password() {
        let name = generate_random_string();
        let entry = entry_new(&name, &name);
        test_round_trip("non-ascii password", &entry, "このきれいな花は桜です");
    }

    #[test]
    fn test_entries_with_same_and_different_specifiers() {
        let name1 = generate_random_string();
        let name2 = generate_random_string();
        let entry1 = entry_new(&name1, &name2);
        let entry2 = entry_new(&name1, &name2);
        let entry3 = entry_new(&name2, &name1);
        entry1.set_password("test password").unwrap();
        let pw2 = entry2.get_password().unwrap();
        assert_eq!(pw2, "test password");
        _ = entry3.get_password().unwrap_err();
        entry1.delete_credential().unwrap();
        _ = entry2.get_password().unwrap_err();
        entry3.delete_credential().unwrap_err();
    }

    #[test]
    fn test_get_credential_and_specifiers() {
        let name = generate_random_string();
        let entry1 = entry_new(&name, &name);
        assert!(matches!(entry1.get_credential(), Err(Error::NoEntry)));
        entry1.set_password("password for entry1").unwrap();
        let wrapper = entry1.get_credential().unwrap();
        let (service, user) = wrapper.get_specifiers().unwrap();
        assert_eq!(service, name);
        assert_eq!(user, name);
        wrapper.delete_credential().unwrap();
        entry1.delete_credential().unwrap_err();
        wrapper.delete_credential().unwrap_err();
    }

    #[test]
    fn test_round_trip_random_secret() {
        let name = generate_random_string();
        let entry = entry_new(&name, &name);
        let secret = generate_random_bytes();
        test_round_trip_secret("non-ascii password", &entry, secret.as_slice());
    }

    #[test]
    fn test_update() {
        let name = generate_random_string();
        let entry = entry_new(&name, &name);
        test_round_trip_no_delete("initial ascii password", &entry, "test ascii password");
        test_round_trip(
            "updated non-ascii password",
            &entry,
            "このきれいな花は桜です",
        );
    }

    #[test]
    fn test_set_error() {
        let name = generate_random_string();
        let entry = entry_new(&name, &name);
        let password = "test ascii password";
        let mock: &Cred = entry.inner.as_any().downcast_ref().unwrap();
        mock.set_error(Error::Invalid(
            "mock error".to_string(),
            "is an error".to_string(),
        ));
        assert!(matches!(
            entry.set_password(password),
            Err(Error::Invalid(_, _))
        ));
        entry.set_password(password).unwrap();
        mock.set_error(Error::NoEntry);
        assert!(matches!(entry.get_password(), Err(Error::NoEntry)));
        let stored_password = entry.get_password().unwrap();
        assert_eq!(stored_password, password);
        mock.set_error(Error::TooLong("mock".to_string(), 3));
        assert!(matches!(
            entry.delete_credential(),
            Err(Error::TooLong(_, 3))
        ));
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_password(), Err(Error::NoEntry)))
    }

    #[test]
    fn test_search() {
        let store: Arc<CredentialStore> = Store::new().unwrap();
        let all = store.search(&HashMap::from([])).unwrap();
        assert!(all.is_empty());
        let all = store
            .search(&HashMap::from([("service", ""), ("user", "")]))
            .unwrap();
        assert!(all.is_empty());
        let e1 = store.build("foo", "bar", None).unwrap();
        e1.set_password("e1").unwrap();
        let all = store.search(&HashMap::from([])).unwrap();
        assert_eq!(all.len(), 1);
        let all = store
            .search(&HashMap::from([("service", ""), ("user", "")]))
            .unwrap();
        assert_eq!(all.len(), 1);
        let e2 = store.build("foo", "bam", None).unwrap();
        e2.set_password("e2").unwrap();
        let one = store.search(&HashMap::from([("user", "m")])).unwrap();
        assert_eq!(one.len(), 1);
        let one = store
            .search(&HashMap::from([("service", "foo"), ("user", "bar")]))
            .unwrap();
        assert_eq!(one.len(), 1);
        let two = store.search(&HashMap::from([("service", "foo")])).unwrap();
        assert_eq!(two.len(), 2);
        let all = store.search(&HashMap::from([("foo", "bar")])).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn test_persistence() {
        let store: Arc<CredentialStore> = Store::new().unwrap();
        assert!(matches!(
            store.persistence(),
            CredentialPersistence::ProcessOnly
        ))
    }
}
