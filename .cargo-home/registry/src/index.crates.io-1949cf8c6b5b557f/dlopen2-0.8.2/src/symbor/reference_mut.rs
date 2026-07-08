use super::super::err::Error;
use super::from_raw::{FromRawResult, RawResult};

use std::ops::{Deref, DerefMut};

/// Safe wrapper around mutable reference.
///
/// This type is intended to be used only inside structures implementing `SymBorApi` trait.
/// In other cases you can as well use normal Rust reference.
#[derive(Debug)]
pub struct RefMut<'lib, T: 'lib> {
    reference: &'lib mut T,
}

impl<'lib, T> RefMut<'lib, T> {
    pub fn new(reference: &'lib mut T) -> RefMut<'lib, T> {
        RefMut { reference }
    }
}

impl<'lib, T> FromRawResult for RefMut<'lib, T> {
    unsafe fn from_raw_result(raw_result: RawResult) -> Result<Self, Error> {
        unsafe {
            match raw_result {
                Ok(ptr) => {
                    if ptr.is_null() {
                        Err(Error::NullSymbol)
                    } else {
                        Ok(RefMut {
                            reference: &mut *(*ptr as *mut T),
                        })
                    }
                }
                Err(err) => Err(err),
            }
        }
    }
}

impl<'lib, T> Deref for RefMut<'lib, T> {
    type Target = T;
    fn deref(&self) -> &T {
        self.reference
    }
}

impl<'lib, T> DerefMut for RefMut<'lib, T> {
    //type Target = T;
    fn deref_mut(&mut self) -> &mut T {
        self.reference
    }
}

unsafe impl<'lib, T: Send> Send for RefMut<'lib, T> {}
unsafe impl<'lib, T: Sync> Sync for RefMut<'lib, T> {}
