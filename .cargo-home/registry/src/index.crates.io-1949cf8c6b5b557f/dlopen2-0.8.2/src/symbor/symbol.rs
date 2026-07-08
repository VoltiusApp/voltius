use super::super::err::Error;
use super::from_raw::{FromRawResult, RawResult};
use std::marker::PhantomData;
use std::mem::transmute_copy;
use std::ops::{Deref, DerefMut};

/// Safe wrapper around a symbol obtained from `Library`.
///
/// This is the most generic type, valid for obtaining functions, references and pointers.
/// It does not accept null value of the library symbol. Other types may provide
/// more specialized functionality better for some use cases.
#[derive(Debug, Clone, Copy)]
pub struct Symbol<'lib, T: 'lib> {
    symbol: T,
    pd: PhantomData<&'lib T>,
}

impl<'lib, T> Symbol<'lib, T> {
    pub fn new(symbol: T) -> Symbol<'lib, T> {
        Symbol {
            symbol,
            pd: PhantomData,
        }
    }
}

impl<'lib, T> FromRawResult for Symbol<'lib, T> {
    unsafe fn from_raw_result(raw_result: RawResult) -> Result<Self, Error> {
        unsafe {
            match raw_result {
                Ok(ptr) => {
                    if ptr.is_null() {
                        Err(Error::NullSymbol)
                    } else {
                        let raw: *const () = *ptr;
                        Ok(Symbol {
                            symbol: transmute_copy(&raw),
                            pd: PhantomData,
                        })
                    }
                }
                Err(err) => Err(err),
            }
        }
    }
}

impl<'lib, T> Deref for Symbol<'lib, T> {
    type Target = T;
    fn deref(&self) -> &T {
        &self.symbol
    }
}

impl<'lib, T> DerefMut for Symbol<'lib, T> {
    //type Target =  T;
    fn deref_mut(&mut self) -> &mut T {
        &mut self.symbol
    }
}

unsafe impl<'lib, T: Send> Send for Symbol<'lib, T> {}
unsafe impl<'lib, T: Sync> Sync for Symbol<'lib, T> {}
