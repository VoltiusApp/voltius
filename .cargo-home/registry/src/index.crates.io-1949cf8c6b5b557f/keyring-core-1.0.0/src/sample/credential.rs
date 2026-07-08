use std::any::Any;
use std::collections::HashMap;
use std::sync::Arc;

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::store::{CredValue, Store};
use crate::attributes::parse_attributes;
use crate::{Credential, Entry, Error, Result, api::CredentialApi};

/// Credentials are specified by a pair of service name and username.
#[derive(Debug, Clone, Eq, PartialEq, Hash, Serialize, Deserialize)]
pub struct CredId {
    pub service: String,
    pub user: String,
}

/// Each of these keys specifies a specific credential in the store.
///
/// For each credential ID, the store maintains a list of all the
/// credentials associated with that ID. The first in that list
/// (element 0) is the credential _specified_ by the ID, so it's
/// the one that's auto-created if there are no credentials with
/// that ID in the store and a password is set. All keys with
/// indices higher than 0 are wrappers for a specific credential,
/// but they do not _specify_ a credential.
#[derive(Clone)]
pub struct CredKey {
    pub store: Arc<Store>,
    pub id: CredId,
    pub uuid: Option<String>,
}

impl std::fmt::Debug for CredKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CredKey")
            .field("id", &self.id)
            .field("uuid", &self.uuid)
            .finish()
    }
}

impl CredKey {
    /// This is the boilerplate for all credential-reading/updating calls.
    ///
    /// It makes sure there is just one credential and, if so, it reads/updates it.
    /// If there is no credential, it returns a NoEntry error.
    /// If there are multiple credentials, it returns an ambiguous error.
    ///
    /// It knows about the difference between specifiers and wrappers
    /// and acts accordingly.
    pub fn with_unique_pair<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&String, &mut CredValue) -> T,
    {
        match self.uuid.as_ref() {
            // this is a wrapper, look for the cred, and if found get it, else fail
            Some(key) => match self.store.creds.get(&self.id) {
                None => Err(Error::NoEntry),
                Some(pair) => match pair.value().get_mut(key) {
                    None => Err(Error::NoEntry),
                    Some(mut cred) => {
                        let (key, val) = cred.pair_mut();
                        Ok(f(key, val))
                    }
                },
            },
            // this is a specifier
            None => {
                match self.store.creds.get(&self.id) {
                    // there are no creds: create the only one and set it
                    None => Err(Error::NoEntry),
                    // this is a specifier: check for ambiguity and get if not
                    Some(pair) => {
                        let creds = pair.value();
                        match creds.len() {
                            // no matching cred, can't read or update
                            0 => Err(Error::NoEntry),
                            // just one current cred, get it
                            1 => {
                                let mut first = creds.iter_mut().next().unwrap();
                                let (key, val) = first.pair_mut();
                                Ok(f(key, val))
                            }
                            // more than one cred - ambiguous!
                            _ => {
                                let mut entries: Vec<Entry> = vec![];
                                for cred in creds.iter() {
                                    let key = CredKey {
                                        store: self.store.clone(),
                                        id: self.id.clone(),
                                        uuid: Some(cred.key().clone()),
                                    };
                                    entries.push(Entry::new_with_credential(Arc::new(key)));
                                }
                                Err(Error::Ambiguous(entries))
                            }
                        }
                    }
                }
            }
        }
    }

    /// A simpler form of boilerplate which just looks at the cred's value
    pub fn with_unique_cred<T, F>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut CredValue) -> T,
    {
        self.with_unique_pair(|_, cred| f(cred))
    }

    /// This returns the UUID of the sole credential for this cred.
    pub fn get_uuid(&self) -> Result<String> {
        self.with_unique_pair(|uuid, _| uuid.to_string())
    }

    /// This returns the comment of the sole credential for this cred.
    pub fn get_comment(&self) -> Result<Option<String>> {
        self.with_unique_pair(|_, cred| cred.comment.clone())
    }
}

impl CredentialApi for CredKey {
    /// See the API docs.
    fn set_secret(&self, secret: &[u8]) -> Result<()> {
        let result = self.with_unique_cred(|cred| cred.secret = secret.to_vec());
        match result {
            Ok(_) => Ok(()),
            // a specifier with no credential: create the cred
            Err(Error::NoEntry) if self.uuid.is_none() => {
                let value = CredValue::new(secret);
                let creds = DashMap::new();
                creds.insert(Uuid::new_v4().to_string(), value);
                self.store.creds.insert(self.id.clone(), creds);
                Ok(())
            }
            // a wrapper with no cred or an ambiguous spec
            Err(e) => Err(e),
        }
    }

    /// See the API docs.
    fn get_secret(&self) -> Result<Vec<u8>> {
        self.with_unique_cred(|cred| cred.secret.clone())
    }

    /// See the API docs.
    ///
    /// The possible attributes on credentials in this store are `uuid`, `comment`,
    /// and `creation-date`.
    fn get_attributes(&self) -> Result<HashMap<String, String>> {
        self.with_unique_pair(|uuid, cred| get_attrs(uuid, cred))
    }

    /// See the API docs.
    ///
    /// Only the `comment` attribute can be updated.
    fn update_attributes(&self, attrs: &HashMap<&str, &str>) -> Result<()> {
        parse_attributes(&["comment"], Some(attrs))?;
        self.with_unique_cred(|cred| update_attrs(cred, attrs))
    }

    /// See the API docs.
    fn delete_credential(&self) -> Result<()> {
        let result = self.with_unique_cred(|_| ());
        match result {
            // there is exactly one matching cred, delete it
            Ok(_) => {
                match self.uuid.as_ref() {
                    // this is a wrapper, delete the credential key from the map
                    Some(uuid) => {
                        self.store.creds.get(&self.id).unwrap().value().remove(uuid);
                        Ok(())
                    }
                    // this is a specifier, and there's only credential, delete the map
                    None => {
                        self.store.creds.remove(&self.id);
                        Ok(())
                    }
                }
            }
            // there's no cred or many creds, return the error
            Err(e) => Err(e),
        }
    }

    /// See the API docs.
    ///
    /// This always returns a new wrapper, even if this is already a wrapper,
    /// because that's just as easy to do once we've checked the error conditions.
    fn get_credential(&self) -> Result<Option<Arc<Credential>>> {
        let result = self.get_uuid();
        match result {
            Ok(uuid) => Ok(Some(Arc::new(CredKey {
                store: self.store.clone(),
                id: self.id.clone(),
                uuid: Some(uuid),
            }))),
            Err(e) => Err(e),
        }
    }

    /// See the API docs.
    fn get_specifiers(&self) -> Option<(String, String)> {
        Some((self.id.service.clone(), self.id.user.clone()))
    }

    /// See the API docs.
    fn as_any(&self) -> &dyn Any {
        self
    }

    /// See the API docs.
    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}

/// get the attributes on a credential
///
/// This is a helper function used by get_attributes
pub fn get_attrs(uuid: &str, cred: &CredValue) -> HashMap<String, String> {
    let mut attrs = HashMap::new();
    attrs.insert("uuid".to_string(), uuid.to_string());
    if let Some(date) = &cred.creation_date {
        attrs.insert("creation-date".to_string(), date.to_string());
    }
    if let Some(comment) = &cred.comment {
        attrs.insert("comment".to_string(), comment.to_string());
    };
    attrs
}

/// update the attributes on a credential
///
/// This is a helper function used by update_attributes
pub fn update_attrs(cred: &mut CredValue, attrs: &HashMap<&str, &str>) {
    if let Some(comment) = attrs.get("comment") {
        cred.comment = Some(comment.to_string());
    }
}
