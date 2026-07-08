use std::collections::HashMap;
use std::sync::{Arc, Once};

use dashmap::DashMap;
use uuid::Uuid;

use super::credential::{CredId, CredKey};
use super::store::{CredValue, Store};
use crate::{CredentialStore, Entry, Error, api::CredentialPersistence, get_default_store};

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

fn entry_new_with_modifiers(service: &str, user: &str, mods: &HashMap<&str, &str>) -> Entry {
    SET_STORE.call_once(usually_goes_in_main);
    Entry::new_with_modifiers(service, user, mods).unwrap_or_else(|err| {
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
        .unwrap_or_else(|err| panic!("Can't get the password for {case}: {err:?}"));
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
        .unwrap_or_else(|err| panic!("Can't delete the password for {case}: {err:?}"));
    let password = entry.get_password();
    assert!(
        matches!(password, Err(Error::NoEntry)),
        "Read a deleted password for {case}",
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
        "Read a deleted password for {case}",
    );
}

#[test]
fn test_empty_service_and_user() {
    let name = generate_random_string();
    let in_pass = "it doesn't matter";
    test_round_trip("empty user", &entry_new(&name, ""), in_pass);
    test_round_trip("empty service", &entry_new("", &name), in_pass);
    test_round_trip("empty service & user", &entry_new("", ""), in_pass);
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
    test_round_trip("ASCII password", &entry, "test ASCII password");
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
    test_round_trip_no_delete("initial ASCII password", &entry, "test ASCII password");
    test_round_trip(
        "updated non-ascii password",
        &entry,
        "このきれいな花は桜です",
    );
}

#[test]
fn test_duplicate_entries() {
    let name = generate_random_string();
    let entry1 = entry_new(&name, &name);
    let entry2 = entry_new(&name, &name);
    entry1.set_password("password for entry1").unwrap();
    let password = entry2.get_password().unwrap();
    assert_eq!(password, "password for entry1");
    entry2.set_password("password for entry2").unwrap();
    let password = entry1.get_password().unwrap();
    assert_eq!(password, "password for entry2");
    entry1.delete_credential().unwrap();
    entry2.delete_credential().expect_err("Can delete entry2");
}

#[test]
fn test_get_update_attributes() {
    let name = generate_random_string();
    let entry1 = entry_new(&name, &name);
    assert!(matches!(entry1.get_attributes(), Err(Error::NoEntry)));
    entry1.set_password("password for entry1").unwrap();
    let attrs = entry1.get_attributes().unwrap();
    assert_eq!(attrs.len(), 1); // uuid
    let unknown_map = HashMap::from([("foo", "bar")]);
    let forbidden_map1 = HashMap::from([("creation-date", "doesn't matter")]);
    let forbidden_map2 = HashMap::from([("uuid", "doesn't matter")]);
    let comment_map = HashMap::from([("comment", "some comment")]);
    assert!(matches!(
        entry1.update_attributes(&unknown_map),
        Err(Error::Invalid(_, _))
    ));
    assert!(matches!(
        entry1.update_attributes(&forbidden_map1),
        Err(Error::Invalid(_, _))
    ));
    assert!(matches!(
        entry1.update_attributes(&forbidden_map2),
        Err(Error::Invalid(_, _))
    ));
    entry1.update_attributes(&comment_map).unwrap();
    assert_eq!(
        entry1.get_attributes().unwrap().get("comment").unwrap(),
        "some comment"
    );
    entry1.delete_credential().unwrap();
    let entry2 =
        entry_new_with_modifiers(&name, &name, &HashMap::from([("force-create", "entry2")]));
    assert_eq!(entry2.get_password().unwrap(), "");
    let attrs = entry2.get_attributes().unwrap();
    assert_eq!(attrs.len(), 3); // uuid, creation date, comment
    assert_eq!(attrs.get("comment").unwrap(), "entry2");
    assert!(attrs.contains_key("creation-date"));
    entry2.update_attributes(&comment_map).unwrap();
    assert_eq!(
        entry2.get_attributes().unwrap().get("comment").unwrap(),
        "some comment"
    );
    entry2.delete_credential().unwrap();
}

#[test]
fn test_get_credential_and_specifiers() {
    let name = generate_random_string();
    let entry1 = entry_new(&name, &name);
    assert!(matches!(entry1.get_credential(), Err(Error::NoEntry)));
    entry1.set_password("password for entry1").unwrap();
    let wrapper = entry1.get_credential().unwrap();
    let cred = wrapper.as_any().downcast_ref::<CredKey>().unwrap();
    assert!(cred.uuid.is_some());
    let (service, user) = wrapper.get_specifiers().unwrap();
    assert_eq!(service, name);
    assert_eq!(user, name);
    wrapper.delete_credential().unwrap();
    entry1.delete_credential().unwrap_err();
    wrapper.delete_credential().unwrap_err();
}

#[test]
fn test_with_unique_credential_helper() {
    let store: Arc<Store> = Store::new().unwrap();
    // test NoEntry
    {
        let name = generate_random_string();
        let id = CredId {
            service: name.clone(),
            user: name.clone(),
        };
        let spec = CredKey {
            store: store.clone(),
            id: id.clone(),
            uuid: None,
        };
        assert!(matches!(spec.with_unique_cred(|_| ()), Err(Error::NoEntry),));
        let wrapper = CredKey {
            store: store.clone(),
            id: id.clone(),
            uuid: Some(Uuid::new_v4().to_string()),
        };
        assert!(matches!(
            wrapper.with_unique_cred(|_| ()),
            Err(Error::NoEntry),
        ));
    }
    // test ambiguity
    {
        let name = generate_random_string();
        let id = CredId {
            service: name.clone(),
            user: name.clone(),
        };
        let spec = CredKey {
            store: store.clone(),
            id: id.clone(),
            uuid: None,
        };
        let uuid1 = Uuid::new_v4().to_string();
        let uuid2 = Uuid::new_v4().to_string();
        let wrapper1 = CredKey {
            store: store.clone(),
            id: id.clone(),
            uuid: Some(uuid1.clone()),
        };
        let wrapper2 = CredKey {
            store: store.clone(),
            id: id.clone(),
            uuid: Some(uuid2.clone()),
        };
        let creds = DashMap::new();
        creds.insert(uuid1.clone(), CredValue::new(&[1u8, 2u8]));
        creds.insert(uuid2.clone(), CredValue::new(&[2u8, 2u8]));
        store.creds.insert(id.clone(), creds);
        assert!(matches!(
            wrapper1.with_unique_cred(|cred| cred.secret[0]),
            Ok(1u8),
        ));
        assert!(matches!(
            wrapper2.with_unique_cred(|cred| cred.secret[0]),
            Ok(2u8),
        ));
        assert!(matches!(
            spec.with_unique_cred(|cred| cred.secret[0]),
            Err(Error::Ambiguous(_)),
        ))
    }
}

#[test]
fn test_credential_and_ambiguous_credential() {
    let name = generate_random_string();
    let entry1 =
        entry_new_with_modifiers(&name, &name, &HashMap::from([("force-create", "entry1")]));
    entry1.set_password("password for entry1").unwrap();
    let credential1: &CredKey = entry1.as_any().downcast_ref().unwrap();
    assert!(credential1.uuid.is_none());
    let entry2 =
        entry_new_with_modifiers(&name, &name, &HashMap::from([("force-create", "entry2")]));
    let credential2: &CredKey = entry2.as_any().downcast_ref().unwrap();
    assert!(credential2.uuid.is_none());
    let err1 = entry1.set_password("password for entry1");
    let Err(Error::Ambiguous(entries1)) = err1 else {
        panic!("not an ambiguous error")
    };
    let err2 = entry2.set_password("password for entry2");
    let Err(Error::Ambiguous(entries2)) = err2 else {
        panic!("not an ambiguous error")
    };
    assert_eq!(entries1.len(), 2);
    assert_eq!(entries2.len(), 2);
    let amb1: &CredKey = entries1[0].as_any().downcast_ref().unwrap();
    let amb2: &CredKey = entries1[1].as_any().downcast_ref().unwrap();
    assert_ne!(amb1.uuid.as_ref().unwrap(), amb2.uuid.as_ref().unwrap());
    assert!(matches!(
        entry2.delete_credential(),
        Err(Error::Ambiguous(_))
    ));
    entries1[0].delete_credential().unwrap();
    entry2.set_password("second password for entry2").unwrap();
    entry1.delete_credential().unwrap();
    entry1.set_password("second password for entry1").unwrap();
    let cred1: &CredKey = entry1.as_any().downcast_ref().unwrap();
    // make sure we got a new UUID after deleting and remaking credential
    assert_ne!(amb1.uuid.as_ref().unwrap(), &cred1.get_uuid().unwrap());
    assert_ne!(amb2.uuid.as_ref().unwrap(), &cred1.get_uuid().unwrap());
    entry1.delete_credential().unwrap();
}

#[test]
fn test_create_then_move() {
    let name = generate_random_string();
    let entry = entry_new(&name, &name);
    let test = move || {
        let password = "test ASCII password";
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
    let password = "test ASCII password";
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
fn test_search() {
    let store: Arc<CredentialStore> = Store::new().unwrap();
    let all = store.search(&HashMap::new()).unwrap();
    assert!(all.is_empty());
    let all = store
        .search(&HashMap::from([("service", ""), ("user", "")]))
        .unwrap();
    assert!(all.is_empty());
    let e1 = store.build("foo", "bar", None).unwrap();
    e1.set_password("e1").unwrap();
    let all = store.search(&HashMap::new()).unwrap();
    assert_eq!(all.len(), 1);
    let all = store
        .search(&HashMap::from([("service", ""), ("user", "")]))
        .unwrap();
    assert_eq!(all.len(), 1);
    let e2 = store.build("foo", "bam", None).unwrap();
    e2.set_password("e2").unwrap();
    let one = store.search(&HashMap::from([("user", "m")])).unwrap();
    assert_eq!(one.len(), 1);
    _ = store
        .build(
            "foo",
            "bar",
            Some(&HashMap::from([("force-create", "foo bar again")])),
        )
        .unwrap();
    let one = store.search(&HashMap::from([("comment", ".+")])).unwrap();
    assert_eq!(one.len(), 1);
    let uuid = one
        .first()
        .unwrap()
        .get_attributes()
        .unwrap()
        .get("uuid")
        .unwrap()
        .clone();
    let one = store
        .search(&HashMap::from([("uuid", uuid.as_str())]))
        .unwrap();
    assert_eq!(one.len(), 1);
    let two = store
        .search(&HashMap::from([("service", "foo"), ("user", "bar")]))
        .unwrap();
    assert_eq!(two.len(), 2);
    let three = store.search(&HashMap::from([("service", "foo")])).unwrap();
    assert_eq!(three.len(), 3);
    store.search(&HashMap::from([("foo", "bar")])).unwrap_err();
}

#[test]
fn test_persistence_no_backing() {
    let store: Arc<CredentialStore> = Store::new().unwrap();
    assert!(matches!(
        store.persistence(),
        CredentialPersistence::ProcessOnly
    ));
}

#[test]
fn test_persistence_with_backing_and_save() {
    let path = std::env::temp_dir()
        .join("store-save-test.ron")
        .to_str()
        .unwrap()
        .to_string();
    _ = std::fs::remove_file(&path);
    let s1 = Store::new_with_backing(&path).unwrap();
    let cred_store: Arc<CredentialStore> = s1.clone();
    assert!(matches!(
        cred_store.persistence(),
        CredentialPersistence::UntilDelete
    ));
    assert_eq!(s1.as_ref().creds.len(), 0);
    let e1 = cred_store.build("s1", "u1", None).unwrap();
    assert_eq!(s1.as_ref().creds.len(), 0);
    e1.set_password("pw1").unwrap();
    assert_eq!(s1.as_ref().creds.len(), 1);
    let e2 = cred_store.build("s2", "u2", None).unwrap();
    assert_eq!(s1.as_ref().creds.len(), 1);
    e2.set_password("pw2").unwrap();
    assert_eq!(s1.as_ref().creds.len(), 2);
    s1.save().unwrap();
    let s2 = Store::new_with_backing(&path).unwrap();
    assert_eq!(s2.as_ref().creds.len(), 2);
}

#[test]
fn test_persistence_with_backing_and_drop() {
    let path = std::env::temp_dir()
        .join("keyring-sample-store.ron")
        .to_str()
        .unwrap()
        .to_string();
    _ = std::fs::remove_file(&path);
    println!("Persistence test path is {path}");
    {
        let s1 = Store::new_with_backing(&path).unwrap();
        let cred_store: Arc<CredentialStore> = s1.clone();
        assert_eq!(s1.as_ref().creds.len(), 0);
        let e1 = cred_store.build("s1", "u1", None).unwrap();
        assert_eq!(s1.as_ref().creds.len(), 0);
        e1.set_password("pw1").unwrap();
        assert_eq!(s1.as_ref().creds.len(), 1);
        let e2 = cred_store.build("s2", "u2", None).unwrap();
        assert_eq!(s1.as_ref().creds.len(), 1);
        e2.set_password("pw2").unwrap();
        assert_eq!(s1.as_ref().creds.len(), 2);
    }
    {
        let s1 = Store::new_with_backing(&path).unwrap();
        assert_eq!(s1.as_ref().creds.len(), 2);
    }
    {
        let s1 = Store::new_with_configuration(&HashMap::from([("persist", "true")])).unwrap();
        assert_eq!(s1.as_ref().creds.len(), 2);
        let store: Arc<CredentialStore> = s1.clone();
        let e3 = store.build("s3", "u3", None).unwrap();
        e3.set_password("pw3").unwrap();
        assert_eq!(s1.as_ref().creds.len(), 3);
    }
    {
        let s1 = Store::new_with_configuration(&HashMap::from([("persist", "true")])).unwrap();
        assert_eq!(s1.as_ref().creds.len(), 3);
    }
}
