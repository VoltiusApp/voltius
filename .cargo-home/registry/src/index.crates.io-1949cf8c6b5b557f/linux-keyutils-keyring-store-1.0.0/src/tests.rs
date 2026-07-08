use std::collections::HashMap;
use std::sync::{Arc, Once};

use keyring_core::{CredentialStore, Entry, Error, api::CredentialPersistence, get_default_store};

use super::{Cred, Store};

static SET_STORE: Once = Once::new();

fn usually_goes_in_main() {
    keyring_core::set_default_store(Store::new().unwrap());
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
    repeat_with(fastrand::alphanumeric).take(12).collect()
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
        .unwrap_or_else(|err| panic!("Can't set password for {case}: {err:?}"));
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
    assert!(
        matches!(password, Err(Error::NoEntry)),
        "Got a deleted password: {case}",
    );
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
    assert!(
        matches!(secret, Err(Error::NoEntry)),
        "Got a deleted password: {case}",
    );
}

#[test]
fn test_invalid_parameter() {
    SET_STORE.call_once(usually_goes_in_main);
    let modifiers = HashMap::from([("description", "")]);
    let entry = Entry::new_with_modifiers("service", "user", &modifiers);
    assert!(matches!(entry, Err(Error::Invalid(_, _))));
    let store: Arc<CredentialStore> =
        Store::new_with_configuration(&HashMap::from([("service_no_divider", "true")])).unwrap();
    let entry = store.build("ser@vice", "user", None);
    assert!(matches!(entry, Err(Error::Invalid(_, _))));
    let store: Arc<CredentialStore> = Store::new_with_configuration(&HashMap::from([
        ("service_no_divider", "true"),
        ("divider", ""),
    ]))
    .unwrap();
    let entry = store.build("service", "user", None);
    assert!(matches!(entry, Err(Error::Invalid(_, _))));
}

#[test]
fn test_missing_entry() {
    let name = generate_random_string();
    let entry = entry_new(&name, &name);
    assert!(matches!(entry.get_password(), Err(Error::NoEntry)))
}

#[test]
fn test_empty_password() {
    let name = generate_random_string();
    let in_pass = "";
    let entry = entry_new(&name, &name);
    assert!(matches!(
        entry.set_password(in_pass),
        Err(Error::Invalid(_, _))
    ));
    _ = entry.delete_credential();
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
fn test_get_credential_and_specifiers() {
    let name1 = generate_random_string();
    let name2 = generate_random_string();
    let entry1 = entry_new(&name1, &name2);
    assert!(matches!(entry1.get_credential(), Err(Error::NoEntry)));
    entry1.set_password("password for entry1").unwrap();
    let cred1 = entry1.as_any().downcast_ref::<Cred>().unwrap();
    let wrapper = entry1.get_credential().unwrap();
    let cred2 = wrapper.as_any().downcast_ref::<Cred>().unwrap();
    assert_eq!(cred1 as *const _, cred2 as *const _);
    let (service, user) = wrapper.get_specifiers().unwrap();
    assert_eq!(service, name1);
    assert_eq!(user, name2);
    entry1.delete_credential().unwrap();
    wrapper.delete_credential().unwrap_err();
    let modifiers = HashMap::from([("description", name1.as_str())]);
    let entry2 = Entry::new_with_modifiers(&name1, &name1, &modifiers).unwrap();
    assert!(entry2.get_specifiers().is_none());
    entry2.delete_credential().unwrap_err();
}

#[test]
fn test_create_then_move() {
    let name = generate_random_string();
    let entry = entry_new(&name, &name);
    let test = move || {
        let password = "test ascii password";
        entry.set_password(password).unwrap();
        let stored_password = entry.get_password().unwrap();
        assert_eq!(stored_password, password);
        let password = "このきれいな花は桜です";
        entry.set_password(password).unwrap();
        let stored_password = entry.get_password().unwrap();
        assert_eq!(stored_password, password);
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_password(), Err(Error::NoEntry)));
    };
    let handle = std::thread::spawn(test);
    assert!(handle.join().is_ok(), "Couldn't execute on thread")
}

#[test]
fn test_simultaneous_create_then_move() {
    let mut handles = vec![];
    for i in 0..10 {
        let name = format!("{}-{}", generate_random_string(), i);
        let entry = entry_new(&name, &name);
        let test = move || {
            entry.set_password(&name).unwrap();
            let stored_password = entry.get_password().unwrap();
            assert_eq!(stored_password, name);
            entry.delete_credential().unwrap();
            assert!(matches!(entry.get_password(), Err(Error::NoEntry)));
        };
        handles.push(std::thread::spawn(test))
    }
    for handle in handles {
        handle.join().unwrap()
    }
}

#[test]
fn test_create_set_then_move() {
    let name = generate_random_string();
    let entry = entry_new(&name, &name);
    let password = "test ascii password";
    entry.set_password(password).unwrap();
    let test = move || {
        let stored_password = entry.get_password().unwrap();
        assert_eq!(stored_password, password);
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_password(), Err(Error::NoEntry)));
    };
    let handle = std::thread::spawn(test);
    assert!(handle.join().is_ok(), "Couldn't execute on thread")
}

#[test]
fn test_simultaneous_create_set_then_move() {
    let mut handles = vec![];
    for i in 0..10 {
        let name = format!("{}-{}", generate_random_string(), i);
        let entry = entry_new(&name, &name);
        entry.set_password(&name).unwrap();
        let test = move || {
            let stored_password = entry.get_password().unwrap();
            assert_eq!(stored_password, name);
            entry.delete_credential().unwrap();
            assert!(matches!(entry.get_password(), Err(Error::NoEntry)));
        };
        handles.push(std::thread::spawn(test))
    }
    for handle in handles {
        handle.join().unwrap()
    }
}

#[test]
fn test_simultaneous_independent_create_set() {
    let mut handles = vec![];
    for i in 0..10 {
        let name = format!("thread_entry{i}");
        let test = move || {
            let entry = entry_new(&name, &name);
            entry.set_password(&name).unwrap();
            let stored_password = entry.get_password().unwrap();
            assert_eq!(stored_password, name);
            entry.delete_credential().unwrap();
            assert!(matches!(entry.get_password(), Err(Error::NoEntry)));
        };
        handles.push(std::thread::spawn(test))
    }
    for handle in handles {
        handle.join().unwrap()
    }
}

#[test]
fn test_multiple_create_delete_single_thread() {
    let name = generate_random_string();
    let entry = entry_new(&name, &name);
    let repeats = 10;
    for _i in 0..repeats {
        entry.set_password(&name).unwrap();
        let stored_password = entry.get_password().unwrap();
        assert_eq!(stored_password, name);
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_password(), Err(Error::NoEntry)));
    }
}

#[test]
fn test_simultaneous_multiple_create_delete_single_thread() {
    let mut handles = vec![];
    for t in 0..10 {
        let name = generate_random_string();
        let test = move || {
            let name = format!("{name}-{t}");
            let entry = entry_new(&name, &name);
            let repeats = 10;
            for _i in 0..repeats {
                entry.set_password(&name).unwrap();
                let stored_password = entry.get_password().unwrap();
                assert_eq!(stored_password, name);
                entry.delete_credential().unwrap();
                assert!(matches!(entry.get_password(), Err(Error::NoEntry)));
            }
        };
        handles.push(std::thread::spawn(test))
    }
    for handle in handles {
        handle.join().unwrap()
    }
}

#[test]
fn test_persistence() {
    let store: Arc<CredentialStore> = Store::new().unwrap();
    assert!(matches!(
        store.persistence(),
        CredentialPersistence::UntilReboot
    ));
}
