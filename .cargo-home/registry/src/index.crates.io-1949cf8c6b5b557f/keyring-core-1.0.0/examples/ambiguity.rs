use keyring_core::{Entry, Error, Result, sample};
use std::collections::HashMap;

fn main() -> Result<()> {
    keyring_core::set_default_store(sample::Store::new()?);
    for resolver in [resolve_with_entries, resolve_with_creds] {
        let e1 = make_ambiguous_entries(4)?;
        match e1.get_password() {
            Ok(pw) => println!("Expected error but got password {pw}"),
            Err(Error::Ambiguous(entries)) => resolver(entries)?,
            Err(e) => println!("Expected Ambiguous error but got {e:?}"),
        }
        println!("After resolution, got password '{}'", e1.get_password()?);
        e1.delete_credential()?;
    }
    keyring_core::unset_default_store();
    Ok(())
}

fn make_ambiguous_entries(count: i32) -> Result<Entry> {
    println!("Creating {count} ambiguous entries, with comments e1...e{count}");
    let e1 = Entry::new_with_modifiers("svc", "usr", &HashMap::from([("force-create", "e1")]))?;
    e1.set_password("password set before ambiguity")?;
    for i in 2..=count {
        let comment = format!("e{}", i);
        let map = HashMap::from([("force-create", comment.as_str())]);
        Entry::new_with_modifiers("svc", "usr", &map)?;
    }
    Ok(e1)
}

fn resolve_with_entries(entries: Vec<Entry>) -> Result<()> {
    for entry in entries {
        let attributes = entry.get_attributes()?;
        let comment = attributes.get("comment").cloned().unwrap();
        let uuid = attributes.get("uuid").cloned().unwrap();
        if comment == "e1" {
            println!("Found wrapper for e1 with uuid {uuid}, setting its password");
            entry.set_password("password set while using entry to resolve ambiguity")?;
        } else {
            println!("Found wrapper for {comment} with uuid {uuid}, deleting it");
            entry.delete_credential()?
        }
    }
    Ok(())
}

fn resolve_with_creds(entries: Vec<Entry>) -> Result<()> {
    for entry in entries {
        let cred = entry.as_any().downcast_ref::<sample::CredKey>().unwrap();
        let comment = cred.get_comment()?.unwrap();
        let uuid = cred.get_uuid()?;
        if comment == "e1" {
            println!("Found wrapper for e1 with uuid {uuid}, setting its password");
            entry.set_password("password set while using cred to resolve ambiguity")?;
        } else {
            println!("Found wrapper for {comment} with uuid {uuid}, deleting it");
            entry.delete_credential()?
        }
    }
    Ok(())
}
