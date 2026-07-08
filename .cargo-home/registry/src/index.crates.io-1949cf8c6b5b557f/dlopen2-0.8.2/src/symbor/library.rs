use crate::raw;

use super::super::raw::Library as RawLib;
use super::ptr_or_null::PtrOrNull;
use super::ptr_or_null_mut::PtrOrNullMut;
use super::symbol::Symbol;
use std::ffi::CStr;
use std::ffi::{CString, OsStr};
use std::ptr::{null, null_mut};

use super::super::err::Error;

/**
Safe wrapper around dynamic link library handle.

Methods of `Library` return only types that make the library borrowed. Therefore the problem with
dangling symbols is prevented.

**Note:**: It is recommended that you use certain methods in certain situations:

* `symbol()` - for obtaining functions and pointers (but only if you can't use references
  instead of pointers and you do not accept null value of a pointer).
* `reference()` and `reference_mut()` - for obtaining access to
  statically allocated objects - either constant or mutable.
* `ptr_or_null()` and `ptr_or_null_mut()` - for obtaining pointers if you accept null values of
  pointers (in 99% of cases you should rather use previously mentioned methods).

#Example

```no_run
use dlopen2::symbor::Library;

fn main(){
    let mut lib = Library::open("libexample.dylib").unwrap();
    let fun = unsafe{lib.symbol::<unsafe extern "C" fn()>("function")}.unwrap();
    unsafe{fun()};
    let glob_val: &mut u32 = unsafe{lib.reference_mut("glob_val")}.unwrap();
    *glob_val = 42;
    let ptr_or_null = unsafe{lib.ptr_or_null::<()>("void_ptr")}.unwrap();
    println!("Pointer is null: {}", ptr_or_null.is_null());
}
```
*/
pub struct Library {
    lib: RawLib,
}

impl Library {
    /// Open dynamic link library using provided file name or path.
    pub fn open<S>(name: S) -> Result<Library, Error>
    where
        S: AsRef<OsStr>,
    {
        Ok(Library {
            lib: RawLib::open(name)?,
        })
    }

    /// Open the program itself as library.
    ///
    /// This allows a shared library to load symbols of the program it was
    /// loaded into.
    pub fn open_self() -> Result<Library, Error> {
        Ok(Library {
            lib: RawLib::open_self()?,
        })
    }

    /// Obtain a symbol from library.
    ///
    /// This method is the most general one and allows obtaining basically everything assuming
    /// that the value of the given symbol cannot be null (use `ptr_or_null()` for this case).
    /// However the `reference()` and `reference_mut()` methods return a native reference and they
    /// are more programmer friendly when you try accessing statically allocated data in
    /// the library.
    pub unsafe fn symbol<T>(&self, name: &str) -> Result<Symbol<'_, T>, Error> {
        Ok(Symbol::new(unsafe { self.lib.symbol(name) }?))
    }

    /// Equivalent of the `symbol()` method but takes `CStr` as a argument.
    pub unsafe fn symbol_cstr<T>(&self, name: &CStr) -> Result<Symbol<'_, T>, Error> {
        unsafe { Ok(Symbol::new(self.lib.symbol_cstr(name)?)) }
    }

    /// Obtain a const pointer from library.
    ///
    /// **Note:** This method is only recommended for data
    /// that can't be accessed as a reference and that can have a null pointer value
    /// (so not in 99% of cases).
    pub unsafe fn ptr_or_null<T>(&self, name: &str) -> Result<PtrOrNull<'_, T>, Error> {
        unsafe {
            let cname = CString::new(name)?;
            self.ptr_or_null_cstr(cname.as_ref())
        }
    }

    /// Equivalent of the `pointer()` method but takes `CStr` as a argument.
    pub unsafe fn ptr_or_null_cstr<T>(&self, name: &CStr) -> Result<PtrOrNull<'_, T>, Error> {
        unsafe {
            let raw_ptr = match self.lib.symbol_cstr(name) {
                Ok(val) => val,
                Err(err) => match err {
                    Error::NullSymbol => null(),
                    _ => return Err(err),
                },
            };
            Ok(PtrOrNull::new(raw_ptr))
        }
    }

    /// Obtain a mutable pointer from library.
    ///
    /// **Note:** This method is only recommended for data
    /// that can't be accessed as a reference and that can have a null pointer value
    /// (so not in 99% of cases).
    pub unsafe fn ptr_or_null_mut<T>(&mut self, name: &str) -> Result<PtrOrNullMut<'_, T>, Error> {
        unsafe {
            let cname = CString::new(name)?;
            self.ptr_or_null_mut_cstr(cname.as_ref())
        }
    }

    /// Equivalent of the `pointer_mut()` method but takes `CStr` as a argument.
    pub unsafe fn ptr_or_null_mut_cstr<T>(
        &mut self,
        name: &CStr,
    ) -> Result<PtrOrNullMut<'_, T>, Error> {
        unsafe {
            let raw_ptr = match self.lib.symbol_cstr(name) {
                Ok(val) => val,
                Err(err) => match err {
                    Error::NullSymbol => null_mut(),
                    _ => return Err(err),
                },
            };
            Ok(PtrOrNullMut::new(raw_ptr))
        }
    }

    /// Obtain const reference to statically allocated data in the library.
    pub unsafe fn reference<T>(&self, name: &str) -> Result<&T, Error> {
        unsafe { self.lib.symbol(name) }
    }

    /// Equivalent of the `reference()` method but takes `CStr` as a argument.
    pub unsafe fn reference_cstr<T>(&self, name: &CStr) -> Result<&T, Error> {
        unsafe { self.lib.symbol_cstr(name) }
    }

    /// Obtain mutable reference to statically allocated data in the library.
    pub unsafe fn reference_mut<T>(&mut self, name: &str) -> Result<&mut T, Error> {
        unsafe { self.lib.symbol(name) }
    }

    /// Equivalent of the `reference_mut()` method but takes `CStr` as a argument.
    pub unsafe fn reference_mut_cstr<T>(&mut self, name: &CStr) -> Result<&mut T, Error> {
        unsafe { self.lib.symbol_cstr(name) }
    }

    /**
    Returns the raw OS handle for the opened library.

    This is `HMODULE` on Windows and `*mut c_void` on Unix systems. Don't use unless absolutely necessary.
    */
    pub unsafe fn into_raw(&self) -> raw::Handle {
        unsafe { self.lib.into_raw() }
    }
}

unsafe impl Send for Library {}
unsafe impl Sync for Library {}
