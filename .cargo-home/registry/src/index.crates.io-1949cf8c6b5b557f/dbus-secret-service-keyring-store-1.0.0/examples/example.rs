//! Example CLI app that creates, writes, reads, examines, and deletes an entry
//! in the Secret Service using APIs from the keyring crate.
use std::collections::HashMap;

use dbus_secret_service_keyring_store::{Store, cred::Specifier};
use keyring_core::{Entry, Error};

fn main() {
    // Set secret service backend as the default store
    keyring_core::set_default_store(Store::new().unwrap());

    let service = "test-service";
    let user = "test-user";
    let password1 = "<PASSWORD1>";
    let password2 = "<PASSWORD2>";
    let entry1 = Entry::new(service, user).unwrap();
    entry1.set_password(password1).unwrap();
    let retrieved = entry1.get_password().unwrap();
    if retrieved != password1 {
        panic!("Passwords do not match");
    }
    println!("Entry with no target: {entry1:?}");
    let modifiers = HashMap::from([("target", "my-special-collection")]);
    let entry2 = Entry::new_with_modifiers(service, user, &modifiers).unwrap();
    entry2.set_password(password2).unwrap();
    let retrieved = entry2.get_password().unwrap();
    if retrieved != password2 {
        panic!("Passwords do not match");
    }
    println!("Entry with a custom target: {entry2:?}");
    // service and user of entry1 are the same as entry2, but it has no target attribute
    assert!(matches!(
        entry1.get_password().unwrap_err(),
        Error::Ambiguous(_)
    ));
    // deleting the collection of entry2 will also delete entry2
    entry2
        .as_any()
        .downcast_ref::<Specifier>()
        .unwrap()
        .delete_target()
        .unwrap();
    // now entry1 is not ambiguous
    entry1.delete_credential().unwrap();

    keyring_core::unset_default_store();
}
