//! keyring-core credential store backed by AndroidX EncryptedSharedPreferences.
//!
//! The EncryptedSharedPreferences / MasterKey work lives in Kotlin
//! (`com.voltius.app.VoltiusKeychain`); this module just calls its three static methods
//! over JNI. The MasterKey is wrapped by the hardware-backed Android Keystore, so this
//! matches the OS-keychain guarantee Voltius relies on for the vault key. Registered as
//! keyring-core's default store on Android in `lib.rs::init_keychain_store`.

use std::any::Any;
use std::collections::HashMap;
use std::sync::Arc;

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use jni::objects::{JString, JValue};
use keyring_core::api::{CredentialApi, CredentialPersistence, CredentialStoreApi};
use keyring_core::{Credential, Entry, Error, Result};

use crate::android_ctx::with_env;

const CLASS: &str = "com/voltius/app/VoltiusKeychain";

fn platform_err(msg: String) -> Error {
    Error::PlatformFailure(msg.into())
}

fn raw_get(storage_key: &str) -> Result<Option<String>> {
    with_env("keychain get", |env, ctx| {
        let jkey = env.new_string(storage_key)?;
        let val = env
            .call_static_method(
                CLASS,
                "get",
                "(Landroid/content/Context;Ljava/lang/String;)Ljava/lang/String;",
                &[JValue::Object(ctx), JValue::Object(&jkey)],
            )?
            .l()?;
        if val.is_null() {
            Ok(None)
        } else {
            let s: String = env.get_string(&JString::from(val))?.into();
            Ok(Some(s))
        }
    })
    .map_err(platform_err)
}

fn raw_set(storage_key: &str, value: &str) -> Result<()> {
    with_env("keychain set", |env, ctx| {
        let jkey = env.new_string(storage_key)?;
        let jval = env.new_string(value)?;
        env.call_static_method(
            CLASS,
            "set",
            "(Landroid/content/Context;Ljava/lang/String;Ljava/lang/String;)V",
            &[
                JValue::Object(ctx),
                JValue::Object(&jkey),
                JValue::Object(&jval),
            ],
        )?
        .v()
    })
    .map_err(platform_err)
}

fn raw_delete(storage_key: &str) -> Result<()> {
    with_env("keychain delete", |env, ctx| {
        let jkey = env.new_string(storage_key)?;
        env.call_static_method(
            CLASS,
            "delete",
            "(Landroid/content/Context;Ljava/lang/String;)V",
            &[JValue::Object(ctx), JValue::Object(&jkey)],
        )?
        .v()
    })
    .map_err(platform_err)
}

/// One flat namespace key per `(service, user)`. Unit separator can't appear in either.
fn storage_key(service: &str, user: &str) -> String {
    format!("{service}\u{1f}{user}")
}

#[derive(Debug)]
struct AndroidCred {
    service: String,
    user: String,
}

impl AndroidCred {
    fn key(&self) -> String {
        storage_key(&self.service, &self.user)
    }
}

impl CredentialApi for AndroidCred {
    fn set_secret(&self, secret: &[u8]) -> Result<()> {
        // Stored values may be arbitrary bytes; base64 so EncryptedSharedPreferences (a
        // String store) round-trips them. get_secret decodes back to the original bytes.
        raw_set(&self.key(), &URL_SAFE_NO_PAD.encode(secret))
    }

    fn get_secret(&self) -> Result<Vec<u8>> {
        match raw_get(&self.key())? {
            None => Err(Error::NoEntry),
            Some(s) => URL_SAFE_NO_PAD
                .decode(s.as_bytes())
                .map_err(|e| Error::BadDataFormat(s.into_bytes(), e.to_string().into())),
        }
    }

    fn delete_credential(&self) -> Result<()> {
        // Contract: NoEntry if it doesn't exist (the Kotlin remove is a silent no-op).
        if raw_get(&self.key())?.is_none() {
            return Err(Error::NoEntry);
        }
        raw_delete(&self.key())
    }

    fn get_credential(&self) -> Result<Option<Arc<Credential>>> {
        if raw_get(&self.key())?.is_none() {
            return Err(Error::NoEntry);
        }
        Ok(None) // self is already a usable wrapper
    }

    fn get_specifiers(&self) -> Option<(String, String)> {
        Some((self.service.clone(), self.user.clone()))
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}

#[derive(Debug)]
pub struct Store;

impl Store {
    pub fn new() -> Arc<Self> {
        Arc::new(Store)
    }
}

impl CredentialStoreApi for Store {
    fn vendor(&self) -> String {
        String::from("Voltius Android EncryptedSharedPreferences store")
    }

    fn id(&self) -> String {
        format!("voltius-android-keychain v{}", env!("CARGO_PKG_VERSION"))
    }

    fn build(
        &self,
        service: &str,
        user: &str,
        modifiers: Option<&HashMap<&str, &str>>,
    ) -> Result<Entry> {
        if modifiers.is_some_and(|m| !m.is_empty()) {
            return Err(Error::NotSupportedByStore(
                "This store does not allow entry modifiers".to_string(),
            ));
        }
        Ok(Entry::new_with_credential(Arc::new(AndroidCred {
            service: service.to_string(),
            user: user.to_string(),
        })))
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn persistence(&self) -> CredentialPersistence {
        CredentialPersistence::UntilDelete
    }

    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}

#[cfg(test)]
mod tests {
    use super::storage_key;

    #[test]
    fn storage_key_combines_service_and_user() {
        assert_eq!(storage_key("voltius", "jwt"), "voltius\u{1f}jwt");
        // Voltius services/keys are fixed ASCII names that never contain the unit
        // separator, so the join is unambiguous in practice.
        assert_ne!(
            storage_key("voltius", "jwt"),
            storage_key("voltius", "mode")
        );
    }
}
