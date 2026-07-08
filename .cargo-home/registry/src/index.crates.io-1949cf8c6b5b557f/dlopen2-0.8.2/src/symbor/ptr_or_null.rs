use super::super::err::Error;
use super::from_raw::{FromRawResult, RawResult};
use std::marker::PhantomData;
use std::ops::Deref;

/// Safe wrapper around const pointer.
///
/// It is recommended only for obtaining pointers that can have null value.
#[derive(Debug, Clone, Copy)]
pub struct PtrOrNull<'lib, T: 'lib> {
    pointer: *const T,
    pd: PhantomData<&'lib T>,
}

impl<'lib, T> PtrOrNull<'lib, T> {
    pub fn new(pointer: *const T) -> PtrOrNull<'lib, T> {
        PtrOrNull {
            pointer,
            pd: PhantomData,
        }
    }
}

impl<'lib, T> FromRawResult for PtrOrNull<'lib, T> {
    unsafe fn from_raw_result(raw_result: RawResult) -> Result<Self, Error> {
        match raw_result {
            Ok(ptr) => Ok(PtrOrNull {
                pointer: *ptr as *const T,
                pd: PhantomData,
            }),
            Err(err) => Err(err),
        }
    }
}

impl<'lib, T> Deref for PtrOrNull<'lib, T> {
    type Target = *const T;
    fn deref(&self) -> &*const T {
        &self.pointer
    }
}

unsafe impl<'lib, T: Send> Send for PtrOrNull<'lib, T> {}
unsafe impl<'lib, T: Sync> Sync for PtrOrNull<'lib, T> {}
