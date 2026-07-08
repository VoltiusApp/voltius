use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use keyring_core::api::CredentialStoreApi;
use keyring_core::attributes::parse_attributes;
use keyring_core::{Entry, Error, Result};

use crate::cred::{Specifier, Wrapper};
use crate::service::Service;

/// Secret service credential store
pub struct Store {
    pub id: String,
    pub(crate) ss: Arc<Service>,
}

impl std::fmt::Debug for Store {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Store")
            .field("vendor", &self.vendor())
            .field("id", &self.id())
            .finish()
    }
}

impl Store {
    /// Create a new store.
    ///
    /// Stores are not configurable.
    pub fn new() -> Result<Arc<Self>> {
        Store::new_internal()
    }

    /// Create a store with the specified configuration.
    ///
    /// Stores are not currently configurable, this entry is provided
    /// so configurability can be added without a major version change.
    pub fn new_with_configuration(config: &HashMap<&str, &str>) -> Result<Arc<Self>> {
        if !config.is_empty() {
            return Err(Error::NotSupportedByStore(
                "Secret Service configuration is not supported".to_string(),
            ));
        }
        Store::new_internal()
    }

    fn new_internal() -> Result<Arc<Self>> {
        let now = SystemTime::now();
        let elapsed = if now.lt(&UNIX_EPOCH) {
            UNIX_EPOCH.duration_since(now).unwrap()
        } else {
            now.duration_since(UNIX_EPOCH).unwrap()
        };
        let id = format!(
            "Crate version {}, Instantiated at {}",
            env!("CARGO_PKG_VERSION"),
            elapsed.as_secs_f64()
        );
        let ss = Arc::new(Service::new()?);
        Ok(Arc::new(Store { id, ss }))
    }
}

impl CredentialStoreApi for Store {
    fn vendor(&self) -> String {
        "Secret Service store, https://crates.io/crates/dbus-secret-service-keyring-store"
            .to_string()
    }

    fn id(&self) -> String {
        self.id.clone()
    }

    /// See the keyring-core API docs.
    fn build(
        &self,
        service: &str,
        user: &str,
        modifiers: Option<&HashMap<&str, &str>>,
    ) -> Result<Entry> {
        let mods = parse_attributes(&["target", "label"], modifiers)?;
        let label = mods.get("label").map(|s| s.as_str());
        if label.map(|l| l.is_empty()).unwrap_or(false) {
            return Err(Error::Invalid(
                "label".to_string(),
                "cannot be empty".to_string(),
            ));
        }
        let target = mods.get("target").map(|s| s.as_str());
        if target.map(|t| t.is_empty()).unwrap_or(false) {
            return Err(Error::Invalid(
                "target".to_string(),
                "cannot be empty".to_string(),
            ));
        }
        Ok(Entry::new_with_credential(Specifier::new(
            self.ss.clone(),
            label,
            target,
            service,
            user,
        )))
    }

    /// See the keyring-core API docs.
    ///
    /// All the key-value pairs are interpreted as attribute/value pairs to
    /// search for (case-sensitive) in the underlying secret service
    /// If the search matches locked items, the search will prompt the user
    /// to unlock them before returning.
    fn search(&self, spec: &HashMap<&str, &str>) -> Result<Vec<Entry>> {
        let paths = self.ss.find_matching_items(spec)?;
        let mut results = Vec::with_capacity(paths.len());
        for path in paths {
            results.push(Entry::new_with_credential(Wrapper::new(
                self.ss.clone(),
                path.clone(),
            )));
        }
        Ok(results)
    }

    /// See the keyring-core API docs.
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}
