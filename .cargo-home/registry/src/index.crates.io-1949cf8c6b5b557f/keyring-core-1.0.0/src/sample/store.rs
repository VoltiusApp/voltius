use std::any::Any;
use std::collections::HashMap;
use std::sync::{Arc, RwLock, Weak};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use log::{debug, error};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::credential::{CredId, CredKey};
use crate::{
    Entry,
    Error::{Invalid, PlatformFailure},
    Result,
    api::{CredentialPersistence, CredentialStoreApi},
    attributes::parse_attributes,
};

/// The stored data for a credential
#[derive(Debug, Serialize, Deserialize)]
pub struct CredValue {
    pub secret: Vec<u8>,
    pub comment: Option<String>,
    pub creation_date: Option<String>,
}

impl CredValue {
    pub fn new(secret: &[u8]) -> Self {
        CredValue {
            secret: secret.to_vec(),
            comment: None,
            creation_date: None,
        }
    }

    pub fn new_ambiguous(comment: &str) -> CredValue {
        CredValue {
            secret: vec![],
            comment: Some(comment.to_string()),
            creation_date: Some(chrono::Local::now().to_rfc2822()),
        }
    }
}

/// A map from <service, user> pairs to matching credentials
pub type CredMap = DashMap<CredId, DashMap<String, CredValue>>;

/// A Store's mutable weak reference to itself
///
/// Because credentials contain an `Arc` to their store,
/// the store needs to keep a `Weak` to itself which can be
/// upgraded to create the credential. Because
/// the Store has to be created and an `Arc` of it taken
/// before that `Arc` can be downgraded and stored inside
/// the Store, the self-reference must be mutable.
pub struct SelfRef {
    inner_store: Weak<Store>,
}

/// A credential store.
///
/// The credential data is kept in the CredMap. We keep the index of
/// ourself in the STORES vector, so we can get a pointer to ourself
/// whenever we need to build a credential.
pub struct Store {
    pub id: String,
    pub creds: CredMap,
    pub backing: Option<String>, // the backing file, if any
    pub self_ref: RwLock<SelfRef>,
}

impl std::fmt::Debug for Store {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Store")
            .field("vendor", &self.vendor())
            .field("id", &self.id)
            .field("backing", &self.backing)
            .field("cred-count", &self.creds.len())
            .finish()
    }
}

impl Drop for Store {
    fn drop(&mut self) {
        if self.backing.is_none() {
            debug!("dropping store {self:?}")
        } else {
            debug!("Saving store {self:?} on drop...");
            match self.save() {
                Ok(_) => debug!("Save of store {self:?} completed"),
                Err(e) => error!("Save of store {self:?} failed: {e:?}"),
            }
        }
    }
}

impl Store {
    /// Create a new store with a default configuration.
    ///
    /// The default configuration is empty with no backing file.
    pub fn new() -> Result<Arc<Self>> {
        Ok(Self::new_internal(DashMap::new(), None))
    }

    /// Create a new store with a user-specified configuration.
    ///
    /// There are two allowed configuration keys: `persist` and `backing-file`. See
    /// the module docs for details of how these affect the store's behavior.
    pub fn new_with_configuration(config: &HashMap<&str, &str>) -> Result<Arc<Self>> {
        let mods = parse_attributes(&["backing-file", "*persist"], Some(config))?;
        if let Some(path) = mods.get("backing-file") {
            Self::new_with_backing(path)
        } else if let Some(persist) = mods.get("persist") {
            if persist == "true" {
                let dir = std::env::temp_dir();
                let path = dir.join("keyring-sample-store.ron");
                Self::new_with_backing(path.to_str().expect("Invalid backing path"))
            } else {
                Self::new()
            }
        } else {
            Self::new()
        }
    }

    /// Create a new store from a backing file.
    ///
    /// The backing file must be a valid path, but it need not exist,
    /// in which case the store starts off empty. If the file does
    /// exist, the initial contents of the store are loaded from it.
    pub fn new_with_backing(path: &str) -> Result<Arc<Self>> {
        Ok(Self::new_internal(
            Self::load_credentials(path)?,
            Some(String::from(path)),
        ))
    }

    /// Save the current state of this store to its backing file.
    ///
    /// This is a no-op if there is no backing file.
    ///
    /// Yes, stores will save themselves to their backing file
    /// when they go out of scope (i.e., are dropped).
    /// But using this entry to take a snapshot can save
    /// you from crashes or let you pass the store state
    /// off to another process.
    pub fn save(&self) -> Result<()> {
        if self.backing.is_none() {
            return Ok(());
        };
        let content = ron::ser::to_string_pretty(&self.creds, ron::ser::PrettyConfig::new())
            .map_err(|e| PlatformFailure(Box::from(e)))?;
        std::fs::write(self.backing.as_ref().unwrap(), content)
            .map_err(|e| PlatformFailure(Box::from(e)))?;
        Ok(())
    }

    /// Create a store with the given credentials and backing file.
    pub fn new_internal(creds: CredMap, backing: Option<String>) -> Arc<Self> {
        let store = Store {
            id: format!(
                "Crate version {}, Instantiated at {}",
                env!("CARGO_PKG_VERSION"),
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_else(|_| Duration::new(0, 0))
                    .as_secs_f64()
            ),
            creds,
            backing,
            self_ref: RwLock::new(SelfRef {
                inner_store: Weak::new(),
            }),
        };
        debug!("Created new store: {store:?}");
        let result = Arc::new(store);
        result.set_store(result.clone());
        result
    }

    /// Loads store content from a backing file.
    ///
    /// If the backing file does not exist, the returned store is empty.
    pub fn load_credentials(path: &str) -> Result<CredMap> {
        match std::fs::exists(path) {
            Ok(true) => match std::fs::read_to_string(path) {
                Ok(s) => Ok(ron::de::from_str(&s).map_err(|e| PlatformFailure(Box::from(e)))?),
                Err(e) => Err(PlatformFailure(Box::from(e))),
            },
            Ok(false) => Ok(DashMap::new()),
            Err(e) => Err(Invalid("Invalid path".to_string(), e.to_string())),
        }
    }

    fn get_store(&self) -> Arc<Store> {
        self.self_ref
            .read()
            .expect("RwLock bug at get!")
            .inner_store
            .upgrade()
            .expect("Arc bug at get!")
    }

    fn set_store(&self, store: Arc<Store>) {
        let mut guard = self.self_ref.write().expect("RwLock bug at set!");
        guard.inner_store = Arc::downgrade(&store);
    }
}

impl CredentialStoreApi for Store {
    /// See the API docs.
    fn vendor(&self) -> String {
        String::from("Sample store, https://crates.io/crates/keyring-core")
    }

    /// See the API docs.
    ///
    /// The store ID is based on its sequence number
    /// in the list of created stores.
    fn id(&self) -> String {
        self.id.clone()
    }

    /// See the API docs.
    ///
    /// The only modifier you can specify is `force-create`, which forces
    /// immediate credential creation and can be used to create ambiguity.
    ///
    /// When the force-create modifier is specified, the created credential gets
    /// an empty password/secret, a `comment` attribute with the value of the modifier,
    /// and a `creation_`date` attribute with a string for the current local time.
    fn build(
        &self,
        service: &str,
        user: &str,
        mods: Option<&HashMap<&str, &str>>,
    ) -> Result<Entry> {
        let id = CredId {
            service: service.to_owned(),
            user: user.to_owned(),
        };
        let key = CredKey {
            store: self.get_store(),
            id: id.clone(),
            uuid: None,
        };
        if let Some(force_create) = parse_attributes(&["force-create"], mods)?.get("force-create") {
            let uuid = Uuid::new_v4().to_string();
            let value = CredValue::new_ambiguous(force_create);
            match self.creds.get(&id) {
                None => {
                    let creds = DashMap::new();
                    creds.insert(uuid, value);
                    self.creds.insert(id, creds);
                }
                Some(creds) => {
                    creds.value().insert(uuid, value);
                }
            };
        }
        Ok(Entry {
            inner: Arc::new(key),
        })
    }

    /// See the API docs.
    ///
    /// The specification must contain exactly two keys - `service` and `user` -
    /// and their values must be valid regular expressions.
    /// Every credential whose service name matches the service regex
    /// _and_ whose username matches the user regex will be returned.
    /// (The match is a substring match, so the empty string will match every value.)
    fn search(&self, spec: &HashMap<&str, &str>) -> Result<Vec<Entry>> {
        let spec = parse_attributes(&["service", "user", "uuid", "comment"], Some(spec))?;
        let mut result: Vec<Entry> = Vec::new();
        let empty = String::new();
        let svc = regex::Regex::new(spec.get("service").unwrap_or(&empty))
            .map_err(|e| Invalid("service regex".to_string(), e.to_string()))?;
        let usr = regex::Regex::new(spec.get("user").unwrap_or(&empty))
            .map_err(|e| Invalid("user regex".to_string(), e.to_string()))?;
        let comment = regex::Regex::new(spec.get("comment").unwrap_or(&empty))
            .map_err(|e| Invalid("comment regex".to_string(), e.to_string()))?;
        let uuid = regex::Regex::new(spec.get("uuid").unwrap_or(&empty))
            .map_err(|e| Invalid("uuid regex".to_string(), e.to_string()))?;
        let store = self.get_store();
        for pair in self.creds.iter() {
            if !svc.is_match(pair.key().service.as_str()) {
                continue;
            }
            if !usr.is_match(pair.key().user.as_str()) {
                continue;
            }
            for cred in pair.value().iter() {
                if !uuid.is_match(cred.key()) {
                    continue;
                }
                if spec.contains_key("comment") {
                    if cred.value().comment.is_none() {
                        continue;
                    }
                    if !comment.is_match(cred.value().comment.as_ref().unwrap()) {
                        continue;
                    }
                }
                result.push(Entry {
                    inner: Arc::new(CredKey {
                        store: store.clone(),
                        id: pair.key().clone(),
                        uuid: Some(cred.key().clone()),
                    }),
                })
            }
        }
        Ok(result)
    }

    //// See the API docs.
    fn as_any(&self) -> &dyn Any {
        self
    }

    //// See the API docs.
    ////
    //// If this store has a backing file, credential persistence is
    //// `UntilDelete`. Otherwise, it's `ProcessOnly`.
    fn persistence(&self) -> CredentialPersistence {
        if self.backing.is_none() {
            CredentialPersistence::ProcessOnly
        } else {
            CredentialPersistence::UntilDelete
        }
    }

    /// See the API docs.
    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}
