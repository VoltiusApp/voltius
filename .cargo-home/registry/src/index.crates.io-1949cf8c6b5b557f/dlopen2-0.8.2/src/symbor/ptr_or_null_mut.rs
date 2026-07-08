use super::super::err::Error;
use super::from_raw::{FromRawResult, RawResult};
use std::marker::PhantomData;
use std::ops::Deref;

/// Safe wrapper around mutable pointer.
///
/// It is recommended only for obtaining pointers that can have null value.
#[derive(Debug, Clone, Copy)]
pub struct PtrOrNullMut<'lib, T: 'lib> {
    pointer: *mut T,
    pd: PhantomData<&'lib T>,
}

impl<'lib, T> PtrOrNullMut<'lib, T> {
    pub fn new(pointer: *mut T) -> PtrOrNullMut<'lib, T> {
        PtrOrNullMut {
            pointer,
            pd: PhantomData,
        }
    }
}

impl<'lib, T> FromRawResult for PtrOrNullMut<'lib, T> {
    unsafe fn from_raw_result(raw_result: RawResult) -> Result<Self, Error> {
        match raw_result {
            Ok(ptr) => Ok(PtrOrNullMut {
                pointer: *ptr as *mut T,
                pd: PhantomData,
            }),
            Err(err) => Err(err),
        }
    }
}

impl<'lib, T> Deref for PtrOrNullMut<'lib, T> {
    type Target = *mut T;
    fn deref(&self) -> &*mut T {
        &self.pointer
    }
}

unsafe impl<'lib, T: Send> Send for PtrOrNullMut<'lib, T> {}
unsafe impl<'lib, T: Sync> Sync for PtrOrNullMut<'lib, T> {}
