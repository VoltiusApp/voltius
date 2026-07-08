use std::collections::HashMap;
use std::sync::Arc;

use dbus_secret_service::Path;

use keyring_core::Entry;
use keyring_core::api::{Credential, CredentialApi};
use keyring_core::error::{Error, Result};

use crate::service::Service;

/// The specifier for an item in the secret-service.
///
/// The label and target are captured from the modifiers
/// used when the specifier was created, so they are
/// available when a matching item needs to be created.
pub struct Specifier {
    ss: Arc<Service>,
    pub label: String,
    pub target: Option<String>,
    pub service: String,
    pub user: String,
}

impl std::fmt::Debug for Specifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Specifier")
            .field("label", &self.label)
            .field("target", &self.target)
            .field("service", &self.service)
            .field("user", &self.user)
            .finish()
    }
}

impl Specifier {
    /// Create a specifier.
    pub(crate) fn new(
        ss: Arc<Service>,
        label: Option<&str>,
        target: Option<&str>,
        service: &str,
        user: &str,
    ) -> Arc<Self> {
        let label = match label {
            None => format!("keyring:{user}@{service}"),
            Some(l) => l.to_string(),
        };
        Arc::new(Self {
            ss,
            label,
            target: target.map(|s| s.to_string()),
            service: service.to_string(),
            user: user.to_string(),
        })
    }

    /// Returns the label on an existing, matching item.
    ///
    /// This may or may not match the one in the specifier.
    pub fn get_label(&self) -> Result<String> {
        let path = self.get_unique_item()?;
        self.ss.get_label(&path)
    }

    /// Sets the label on an existing, matching item.
    ///
    /// Note that this doesn't update the specifier. If you delete
    /// the item and recreate it, the label will come from the specifier.
    pub fn set_label(&self, label: &str) -> Result<()> {
        let path = self.get_unique_item()?;
        self.ss.set_label(&path, label)
    }

    /// Deletes the target collection in the specifier
    pub fn delete_target(&self) -> Result<()> {
        match self.target.clone() {
            None => Err(Error::Invalid("target".to_string(), "not set".to_string())),
            Some(s) => self.ss.delete_collection(&s),
        }
    }

    fn get_unique_item(&self) -> Result<Path<'static>> {
        let paths = self.ss.find_matching_items(&self.search_attributes())?;
        match paths.len() {
            0 => Err(Error::NoEntry),
            1 => Ok(paths[0].clone()),
            _ => {
                let mut entries: Vec<Entry> = Vec::with_capacity(paths.len());
                for path in paths {
                    entries.push(Entry::new_with_credential(Wrapper::new(
                        self.ss.clone(),
                        path,
                    )))
                }
                Err(Error::Ambiguous(entries))
            }
        }
    }

    /// Provide a HashMap of search attributes for this specifier.
    fn search_attributes(&self) -> HashMap<&str, &str> {
        let mut result: HashMap<&str, &str> = HashMap::new();
        result.insert("service", self.service.as_str());
        result.insert("username", self.user.as_str());
        if let Some(target) = &self.target {
            result.insert("target", target.as_str());
        }
        result
    }
}

impl CredentialApi for Specifier {
    /// See the keyring-core API docs.
    fn set_secret(&self, secret: &[u8]) -> Result<()> {
        // first try to find a unique, existing, matching item and set its password
        match self.get_unique_item() {
            Ok(p) => return self.ss.set_secret(&p, secret),
            Err(Error::NoEntry) => {}
            Err(err) => return Err(err),
        }
        // if there is no existing item, create one for this credential.
        let collection = self.target.clone().unwrap_or("default".to_string());
        self.ss
            .create_item(&collection, &self.label, self.search_attributes(), secret)
    }

    /// See the keyring-core API docs.
    fn get_secret(&self) -> Result<Vec<u8>> {
        let path = self.get_unique_item()?;
        self.ss.get_secret(&path)
    }

    /// See the keyring-core API docs.
    fn get_attributes(&self) -> Result<HashMap<String, String>> {
        let path = self.get_unique_item()?;
        self.ss.get_attributes(&path)
    }

    /// See the keyring-core API docs.
    fn update_attributes(&self, attributes: &HashMap<&str, &str>) -> Result<()> {
        for key in attributes.keys() {
            if *key == "target" || *key == "service" || *key == "username" {
                return Err(Error::Invalid(
                    key.to_string(),
                    "cannot be updated".to_string(),
                ));
            }
        }
        let path = self.get_unique_item()?;
        self.ss.update_attributes(&path, attributes)
    }

    /// See the keyring-core API docs.
    fn delete_credential(&self) -> Result<()> {
        let path = self.get_unique_item()?;
        self.ss.delete(&path)
    }

    /// See the keyring-core API docs.
    fn get_credential(&self) -> Result<Option<Arc<Credential>>> {
        let path = self.get_unique_item()?;
        Ok(Some(Wrapper::new(self.ss.clone(), path)))
    }

    /// See the keyring-core API docs.
    fn get_specifiers(&self) -> Option<(String, String)> {
        Some((self.service.clone(), self.user.clone()))
    }

    /// See the keyring-core API docs.
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    /// See the keyring-core API docs.
    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}

/// A wrapper around a secret-service item.
///
/// Items in the Secret Service are uniquely identified by their path,
/// but the path is (per the spec) not supposed to be exposed to clients,
/// so it's held privately. It is available to the debugger.
pub struct Wrapper {
    ss: Arc<Service>,
    path: Path<'static>,
}

impl std::fmt::Debug for Wrapper {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Wrapper").field("path", &self.path).finish()
    }
}

impl Wrapper {
    pub(crate) fn new(ss: Arc<Service>, path: Path<'static>) -> Arc<Self> {
        Arc::new(Self { ss, path })
    }

    /// Returns the label on the wrapped item.
    pub fn get_label(&self) -> Result<String> {
        self.ss.ensure_unlocked(&self.path)?;
        self.ss.get_label(&self.path)
    }

    /// Sets the label on the wrapped item.
    pub fn set_label(&self, label: &str) -> Result<()> {
        self.ss.ensure_unlocked(&self.path)?;
        self.ss.set_label(&self.path, label)
    }

    /// Gets the path of the wrapped item.
    pub fn get_path(&self) -> String {
        self.path.to_string()
    }
}

impl CredentialApi for Wrapper {
    /// See the keyring-core API docs.
    fn set_secret(&self, secret: &[u8]) -> Result<()> {
        self.ss.ensure_unlocked(&self.path)?;
        self.ss.set_secret(&self.path, secret)
    }

    /// See the keyring-core API docs.
    fn get_secret(&self) -> Result<Vec<u8>> {
        self.ss.ensure_unlocked(&self.path)?;
        self.ss.get_secret(&self.path)
    }

    /// See the keyring-core API docs.
    fn get_attributes(&self) -> Result<HashMap<String, String>> {
        self.ss.ensure_unlocked(&self.path)?;
        self.ss.get_attributes(&self.path)
    }

    /// See the keyring-core API docs.
    fn update_attributes(&self, attributes: &HashMap<&str, &str>) -> Result<()> {
        self.ss.ensure_unlocked(&self.path)?;
        self.ss.update_attributes(&self.path, attributes)
    }

    /// See the keyring-core API docs.
    fn delete_credential(&self) -> Result<()> {
        self.ss.ensure_unlocked(&self.path)?;
        self.ss.delete(&self.path)
    }

    /// See the keyring-core API docs.
    fn get_credential(&self) -> Result<Option<Arc<Credential>>> {
        self.ss.ensure_unlocked(&self.path)?;
        Ok(None)
    }

    /// See the keyring-core API docs.
    fn get_specifiers(&self) -> Option<(String, String)> {
        if self.ss.ensure_unlocked(&self.path).is_err() {
            return None;
        }
        let attributes = self.ss.get_attributes(&self.path).unwrap_or_default();
        if let Some(service) = attributes.get("service")
            && let Some(user) = attributes.get("username")
        {
            return Some((service.to_string(), user.to_string()));
        }
        None
    }

    /// See the keyring-core API docs.
    fn as_any(&self) -> &dyn std::any::Any {
        self
    }

    /// See the keyring-core API docs.
    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}
