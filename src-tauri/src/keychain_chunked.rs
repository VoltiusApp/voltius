//! Windows Credential Manager refuses a value over 2560 bytes once UTF-16 encoded, so a
//! longer one is split across chunk items and the key holds a pointer to them.

use std::any::Any;
use std::collections::HashMap;
use std::sync::Arc;

use keyring_core::api::{CredentialApi, CredentialPersistence, CredentialStoreApi};
use keyring_core::{Credential, CredentialStore, Entry, Error, Result};

pub const WINDOWS_MAX_UNITS: usize = 1280;
const POINTER: &str = "\u{1}voltius-chunked:";

#[derive(Clone, Copy, PartialEq, Debug)]
struct Chunks {
    generation: u32,
    count: usize,
}

impl Chunks {
    fn parse(head: &str) -> Option<Self> {
        let (generation, count) = head.strip_prefix(POINTER)?.split_once(':')?;
        Some(Chunks {
            generation: generation.parse().ok()?,
            count: count.parse().ok()?,
        })
    }

    fn pointer(self) -> String {
        format!("{POINTER}{}:{}", self.generation, self.count)
    }
}

fn split(value: &str, max_units: usize) -> Vec<&str> {
    let mut pieces = Vec::new();
    let (mut start, mut units) = (0, 0);
    for (at, c) in value.char_indices() {
        if units + c.len_utf16() > max_units {
            pieces.push(&value[start..at]);
            (start, units) = (at, 0);
        }
        units += c.len_utf16();
    }
    pieces.push(&value[start..]);
    pieces
}

#[derive(Debug)]
struct ChunkedCred {
    inner: Arc<CredentialStore>,
    service: String,
    user: String,
    max_units: usize,
}

impl ChunkedCred {
    fn item(&self, user: &str) -> Result<Entry> {
        self.inner.build(&self.service, user, None)
    }

    fn head(&self) -> Result<Entry> {
        self.item(&self.user)
    }

    fn chunk(&self, chunks: Chunks, index: usize) -> Result<Entry> {
        self.item(&format!("{}#{}.{index}", self.user, chunks.generation))
    }

    fn current_chunks(&self) -> Option<Chunks> {
        Chunks::parse(&self.head().ok()?.get_password().ok()?)
    }

    fn drop_chunks(&self, chunks: Option<Chunks>) {
        let Some(chunks) = chunks else { return };
        for index in 0..chunks.count {
            if let Err(e) = self
                .chunk(chunks, index)
                .and_then(|e| e.delete_credential())
            {
                if !matches!(e, Error::NoEntry) {
                    log::warn!("could not delete keychain chunk {}#{index}: {e}", self.user);
                }
            }
        }
    }
}

impl CredentialApi for ChunkedCred {
    fn set_password(&self, password: &str) -> Result<()> {
        let previous = self.current_chunks();
        let units = password.encode_utf16().count();
        if units <= self.max_units && !password.starts_with(POINTER) {
            self.head()?.set_password(password)?;
        } else {
            let pieces = split(password, self.max_units);
            let chunks = Chunks {
                generation: previous.map_or(0, |p| p.generation.wrapping_add(1)),
                count: pieces.len(),
            };
            for (index, piece) in pieces.into_iter().enumerate() {
                self.chunk(chunks, index)?.set_password(piece)?;
            }
            self.head()?.set_password(&chunks.pointer())?;
        }
        self.drop_chunks(previous);
        Ok(())
    }

    fn get_password(&self) -> Result<String> {
        let head = self.head()?.get_password()?;
        let Some(chunks) = Chunks::parse(&head) else {
            return Ok(head);
        };
        (0..chunks.count)
            .map(|index| match self.chunk(chunks, index)?.get_password() {
                Err(Error::NoEntry) => Err(Error::BadStoreFormat(format!(
                    "keychain chunk {}#{index} is missing",
                    self.user
                ))),
                other => other,
            })
            .collect()
    }

    fn set_secret(&self, secret: &[u8]) -> Result<()> {
        self.head()?.set_secret(secret)
    }

    fn get_secret(&self) -> Result<Vec<u8>> {
        self.head()?.get_secret()
    }

    fn delete_credential(&self) -> Result<()> {
        let previous = self.current_chunks();
        self.head()?.delete_credential()?;
        self.drop_chunks(previous);
        Ok(())
    }

    fn get_credential(&self) -> Result<Option<Arc<Credential>>> {
        self.get_password().map(|_| None)
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

/// Chunks values of services for which `chunked` holds; every other service passes through.
#[derive(Debug)]
pub struct Store {
    inner: Arc<CredentialStore>,
    chunked: fn(&str) -> bool,
    max_units: usize,
}

impl Store {
    pub fn new(
        inner: Arc<CredentialStore>,
        chunked: fn(&str) -> bool,
        max_units: usize,
    ) -> Arc<Self> {
        Arc::new(Store {
            inner,
            chunked,
            max_units,
        })
    }
}

impl CredentialStoreApi for Store {
    fn vendor(&self) -> String {
        format!("Voltius chunked values over {}", self.inner.vendor())
    }

    fn id(&self) -> String {
        format!("voltius-keychain-chunked v{}", env!("CARGO_PKG_VERSION"))
    }

    fn build(
        &self,
        service: &str,
        user: &str,
        modifiers: Option<&HashMap<&str, &str>>,
    ) -> Result<Entry> {
        if !(self.chunked)(service) {
            return self.inner.build(service, user, modifiers);
        }
        crate::keychain_bundle::reject_modifiers(modifiers)?;
        Ok(Entry::new_with_credential(Arc::new(ChunkedCred {
            inner: self.inner.clone(),
            service: service.to_string(),
            user: user.to_string(),
            max_units: self.max_units,
        })))
    }

    fn as_any(&self) -> &dyn Any {
        self
    }

    fn persistence(&self) -> CredentialPersistence {
        self.inner.persistence()
    }

    fn debug_fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(self, f)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use keyring_core::mock;

    const SVC: &str = "voltius";
    const MAX: usize = 8;

    struct Fixture {
        inner: Arc<CredentialStore>,
        store: Arc<Store>,
    }

    fn fixture() -> Fixture {
        let inner: Arc<CredentialStore> = mock::Store::new().unwrap();
        let store = Store::new(inner.clone(), |s| s.starts_with("voltius"), MAX);
        Fixture { inner, store }
    }

    impl Fixture {
        fn entry(&self, user: &str) -> Entry {
            self.store.build(SVC, user, None).unwrap()
        }

        fn raw(&self, user: &str) -> Result<String> {
            self.inner.build(SVC, user, None).unwrap().get_password()
        }
    }

    #[test]
    fn short_value_is_stored_as_is() {
        let f = fixture();
        f.entry("jwt").set_password("token").unwrap();
        assert_eq!(f.raw("jwt").unwrap(), "token");
        assert_eq!(f.entry("jwt").get_password().unwrap(), "token");
    }

    #[test]
    fn long_value_round_trips_through_chunks_within_the_limit() {
        let f = fixture();
        let value = "é€😀abcdefghijklmnopqrstuvwxyz";
        f.entry("acct").set_password(value).unwrap();
        assert_eq!(f.entry("acct").get_password().unwrap(), value);
        let chunks = Chunks::parse(&f.raw("acct").unwrap()).unwrap();
        for index in 0..chunks.count {
            let piece = f
                .raw(&format!("acct#{}.{index}", chunks.generation))
                .unwrap();
            assert!(piece.encode_utf16().count() <= MAX);
        }
    }

    #[test]
    fn rewrites_and_delete_leave_no_stale_chunks() {
        let f = fixture();
        f.entry("acct")
            .set_password("0123456789abcdefghij")
            .unwrap();
        let first = Chunks::parse(&f.raw("acct").unwrap()).unwrap();
        f.entry("acct")
            .set_password("0123456789abcdefghijklmn")
            .unwrap();
        let second = Chunks::parse(&f.raw("acct").unwrap()).unwrap();
        assert_ne!(first.generation, second.generation);
        assert!(matches!(f.raw("acct#0.0"), Err(Error::NoEntry)));

        f.entry("acct").set_password("short").unwrap();
        assert_eq!(f.raw("acct").unwrap(), "short");
        assert!(matches!(f.raw("acct#1.0"), Err(Error::NoEntry)));

        f.entry("acct")
            .set_password("0123456789abcdefghij")
            .unwrap();
        f.entry("acct").delete_credential().unwrap();
        assert!(matches!(
            f.entry("acct").get_password(),
            Err(Error::NoEntry)
        ));
        assert!(matches!(f.raw("acct#0.0"), Err(Error::NoEntry)));
    }

    #[test]
    fn value_that_looks_like_a_pointer_is_not_misread() {
        let f = fixture();
        let value = format!("{POINTER}0:1");
        f.entry("x").set_password(&value).unwrap();
        assert_eq!(f.entry("x").get_password().unwrap(), value);
    }

    #[test]
    fn failed_chunk_write_keeps_the_previous_value() {
        let f = fixture();
        f.entry("acct").set_password("old").unwrap();
        let chunk = f.inner.build(SVC, "acct#0.1", None).unwrap();
        let cred: &mock::Cred = chunk.as_any().downcast_ref().unwrap();
        cred.set_error(Error::NoStorageAccess("denied".into()));
        assert!(f
            .entry("acct")
            .set_password("0123456789abcdefghij")
            .is_err());
        assert_eq!(f.entry("acct").get_password().unwrap(), "old");
    }

    #[test]
    fn missing_chunk_is_an_error_not_a_truncated_value() {
        let f = fixture();
        f.entry("acct")
            .set_password("0123456789abcdefghij")
            .unwrap();
        f.inner
            .build(SVC, "acct#0.1", None)
            .unwrap()
            .delete_credential()
            .unwrap();
        assert!(matches!(
            f.entry("acct").get_password(),
            Err(Error::BadStoreFormat(_))
        ));
    }

    #[test]
    fn other_services_pass_through() {
        let f = fixture();
        let entry = f.store.build("Termius", "localKey", None).unwrap();
        entry.set_password("0123456789abcdefghij").unwrap();
        let raw = f.inner.build("Termius", "localKey", None).unwrap();
        assert_eq!(raw.get_password().unwrap(), "0123456789abcdefghij");
    }
}
