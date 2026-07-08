/*!

Shared secret-service access.

This module provides mutex-protected shared access from credentials
to the Secret Service. Each store holds the singleton used by its creds.

*/

#[cfg(not(any(feature = "crypto-rust", feature = "crypto-openssl")))]
compile_error!("You must enable one of the features crypto-rust or crypto-openssl");

use std::collections::HashMap;
use std::sync::Mutex;

use crate::errors::{decode_error, platform_failure};
use dbus_secret_service::{EncryptionType, Item, Path, SecretService};
use keyring_core::{Error, Result};

pub(crate) struct Service {
    ss: Mutex<SecretService>,
}

impl Service {
    pub(crate) fn new() -> Result<Self> {
        Ok(Self {
            ss: Mutex::new(SecretService::connect(EncryptionType::Dh).map_err(platform_failure)?),
        })
    }

    pub(crate) fn find_matching_items(
        &self,
        attributes: &HashMap<&str, &str>,
    ) -> Result<Vec<Path<'static>>> {
        let ss = self
            .ss
            .lock()
            .expect("Mutex failure in credential store: please report a bug");
        let search = ss.search_items(attributes.clone()).map_err(decode_error)?;
        if !search.locked.is_empty() {
            let item_refs: Vec<&Item> = search.locked.iter().collect();
            ss.unlock_all(item_refs.as_slice()).map_err(decode_error)?;
        }
        let results = search
            .unlocked
            .iter()
            .chain(search.locked.iter())
            .map(|i| i.path.clone())
            .collect();
        Ok(results)
    }

    pub(crate) fn create_item(
        &self,
        collection: &str,
        label: &str,
        attributes: HashMap<&str, &str>,
        secret: &[u8],
    ) -> Result<()> {
        let ss = self
            .ss
            .lock()
            .expect("Mutex failure in credential store: please report a bug");
        let collection = match util::get_collection(&ss, collection) {
            Ok(c) => c,
            Err(Error::NoEntry) => util::create_collection(&ss, collection)?,
            Err(e) => return Err(e),
        };
        collection
            .create_item(
                label,
                attributes,
                secret,
                true, // replace
                "application/octet-stream",
            )
            .map_err(platform_failure)?;
        Ok(())
    }

    pub(crate) fn delete_collection(&self, collection: &str) -> Result<()> {
        let ss = self
            .ss
            .lock()
            .expect("Mutex failure in credential store: please report a bug");
        if collection.eq("default") {
            return Err(Error::NotSupportedByStore(
                "You cannot delete the default collection".to_string(),
            ));
        }
        match util::get_collection(&ss, collection) {
            Ok(c) => c.delete().map_err(decode_error),
            Err(e) => Err(e),
        }
    }

    /// Given an item's path, ensure it exists and is unlocked
    pub(crate) fn ensure_unlocked(&self, path: &Path<'static>) -> Result<()> {
        let ss = self
            .ss
            .lock()
            .expect("Mutex failure in credential store: please report a bug");
        let item = Item::new(&ss, path.clone());
        item.ensure_unlocked().map_err(decode_error)
    }

    /// Given an item's path, set its secret.
    pub(crate) fn set_secret(&self, path: &Path<'static>, secret: &[u8]) -> Result<()> {
        let ss = self
            .ss
            .lock()
            .expect("Mutex failure in credential store: please report a bug");
        let item = Item::new(&ss, path.clone());
        item.set_secret(secret, "text/plain").map_err(decode_error)
    }

    /// Given an existing item's path, retrieve its secret.
    pub(crate) fn get_secret(&self, path: &Path<'static>) -> Result<Vec<u8>> {
        let ss = self
            .ss
            .lock()
            .expect("Mutex failure in credential store: please report a bug");
        let item = Item::new(&ss, path.clone());
        let secret = item.get_secret().map_err(decode_error)?;
        Ok(secret)
    }

    /// Given an existing item's path, retrieve its attributes.
    pub(crate) fn get_attributes(&self, path: &Path<'static>) -> Result<HashMap<String, String>> {
        let ss = self
            .ss
            .lock()
            .expect("Mutex failure in credential store: please report a bug");
        let item = Item::new(&ss, path.clone());
        let attributes = item.get_attributes().map_err(decode_error)?;
        Ok(attributes)
    }

    /// Given an existing item's path, update its attributes.
    pub(crate) fn update_attributes(
        &self,
        path: &Path<'static>,
        attributes: &HashMap<&str, &str>,
    ) -> Result<()> {
        let ss = self
            .ss
            .lock()
            .expect("Mutex failure in credential store: please report a bug");
        let item = Item::new(&ss, path.clone());
        let existing = item.get_attributes().map_err(decode_error)?;
        let mut updated: HashMap<&str, &str> = HashMap::new();
        for (k, v) in existing.iter() {
            updated.insert(k, v);
        }
        for (k, v) in attributes.iter() {
            updated.insert(k, v);
        }
        item.set_attributes(updated).map_err(decode_error)?;
        Ok(())
    }

    // Given an existing item's path, delete it.
    pub(crate) fn delete(&self, path: &Path<'static>) -> Result<()> {
        let ss = self
            .ss
            .lock()
            .expect("Mutex failure in credential store: please report a bug");
        let item = Item::new(&ss, path.clone());
        item.delete().map_err(decode_error)
    }

    // Given an existing item's path, return its label.
    pub(crate) fn get_label(&self, path: &Path<'static>) -> Result<String> {
        let ss = self
            .ss
            .lock()
            .expect("Mutex failure in credential store: please report a bug");
        let item = Item::new(&ss, path.clone());
        let label = item.get_label().map_err(decode_error)?;
        Ok(label)
    }

    // Given an existing item's path, set its label.
    pub(crate) fn set_label(&self, path: &Path<'static>, label: &str) -> Result<()> {
        let ss = self
            .ss
            .lock()
            .expect("Mutex failure in credential store: please report a bug");
        let item = Item::new(&ss, path.clone());
        item.set_label(label).map_err(decode_error)
    }
}

/// Secret Service utilities: this module is private because these can't
/// be called except from the methods of the Service struct which has
/// made the service singleton available.
mod util {
    use super::{Error, Result, decode_error};

    use dbus_secret_service::{Collection, SecretService};

    /// Find the secret service collection whose label is the given name.
    ///
    /// The name `default` is treated specially and is interpreted as naming
    /// the default collection regardless of its label (which might be different).
    pub(crate) fn get_collection<'a>(ss: &'a SecretService, name: &str) -> Result<Collection<'a>> {
        let collection = if name.eq("default") {
            ss.get_default_collection().map_err(decode_error)?
        } else {
            let all = ss.get_all_collections().map_err(decode_error)?;
            let found = all
                .into_iter()
                .find(|c| c.get_label().map(|l| l.eq(name)).unwrap_or(false));
            found.ok_or(Error::NoEntry)?
        };
        if collection.is_locked().map_err(decode_error)? {
            collection.unlock().map_err(decode_error)?;
        }
        Ok(collection)
    }

    /// Create a secret service collection labeled with the given name.
    ///
    /// If a collection with that name already exists, it is returned.
    ///
    /// The name `default` is specially interpreted to mean the default collection.
    pub(crate) fn create_collection<'a>(
        ss: &'a SecretService,
        name: &str,
    ) -> Result<Collection<'a>> {
        let collection = if name.to_ascii_lowercase().eq("default") {
            ss.get_default_collection().map_err(decode_error)?
        } else {
            ss.create_collection(name, "").map_err(decode_error)?
        };
        Ok(collection)
    }
}
