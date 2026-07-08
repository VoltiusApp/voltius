//! Example CLI app that creates, writes, reads, examines, and deletes an entry
//! in the keyutils keystore using APIs from the keyring crate.
use std::collections::HashMap;

use keyring_core::Entry;
use linux_keyutils_keyring_store::Store;

fn main() {
    // Set keyutils backend as the default store
    keyring_core::set_default_store(Store::new().unwrap());

    let service = "service";
    let username = "user";
    let password = "<PASSWORD>";
    let entry = Entry::new(service, username).unwrap();
    entry.set_password(password).unwrap();
    let retrieved = entry.get_password().unwrap();
    if retrieved != password {
        panic!("Passwords do not match");
    }
    println!("Entry with no target: {:?}", entry);
    entry.delete_credential().unwrap();
    let modifiers = HashMap::from([("description", "custom description")]);
    let entry = Entry::new_with_modifiers("ignored", "ignored", &modifiers).unwrap();
    entry.set_password(password).unwrap();
    let retrieved = entry.get_password().unwrap();
    if retrieved != password {
        panic!("Passwords do not match");
    }
    println!("Entry with custom description: {:?}", entry);
    entry.delete_credential().unwrap();
    keyring_core::unset_default_store();
}
