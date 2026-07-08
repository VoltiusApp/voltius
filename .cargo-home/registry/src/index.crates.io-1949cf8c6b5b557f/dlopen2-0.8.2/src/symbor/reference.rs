use super::super::err::Error;
use super::from_raw::{FromRawResult, RawResult};

use std::ops::Deref;

/// Safe wrapper around cont reference.
///
/// This type is intended to be used only inside structures implementing `SymBorApi` trait.
/// In other cases you can as well use normal Rust reference.
#[derive(Debug, Clone, Copy)]
pub struct Ref<'lib, T: 'lib> {
    reference: &'lib T,
}

impl<'lib, T> Ref<'lib, T> {
    pub fn new(reference: &'lib T) -> Ref<'lib, T> {
        Ref { reference }
    }
}

impl<'lib, T> FromRawResult for Ref<'lib, T> {
    unsafe fn from_raw_result(raw_result: RawResult) -> Result<Self, Error> {
        unsafe {
            match raw_result {
                Ok(ptr) => {
                    if ptr.is_null() {
                        Err(Error::NullSymbol)
                    } else {
                        Ok(Ref {
                            reference: &*(*ptr as *const T),
                        })
                    }
                }
                Err(err) => Err(err),
            }
        }
    }
}

impl<'lib, T> Deref for Ref<'lib, T> {
    type Target = T;
    fn deref(&self) -> &T {
        self.reference
    }
}

unsafe impl<'lib, T: Send> Send for Ref<'lib, T> {}
unsafe impl<'lib, T: Sync> Sync for Ref<'lib, T> {}
