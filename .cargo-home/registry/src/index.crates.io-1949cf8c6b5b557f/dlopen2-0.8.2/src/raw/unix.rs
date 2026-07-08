#![allow(clippy::let_unit_value)]

use super::super::err::Error;
use super::common::{AddressInfo, OverlappingSymbol};
use libc::{Dl_info, RTLD_LAZY, RTLD_LOCAL, dladdr, dlclose, dlerror, dlopen, dlsym};
use std::ffi::{CStr, OsStr};
use std::io::{Error as IoError, ErrorKind};
use std::os::raw::{c_int, c_void};
use std::os::unix::ffi::OsStrExt;
use std::ptr::{null, null_mut};

const DEFAULT_FLAGS: c_int = RTLD_LOCAL | RTLD_LAZY;

// calls to dlerror are not thread-safe on some platforms,
// so we guard them with a mutex if required
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
use {
    once_cell::sync::Lazy,
    std::sync::{LockResult, Mutex, MutexGuard},
};
#[cfg(not(any(target_os = "linux", target_os = "macos")))]
fn lock_dlerror_mutex() -> LockResult<MutexGuard<'static, ()>> {
    static DLERROR_MUTEX: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));

    DLERROR_MUTEX.lock()
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
fn lock_dlerror_mutex() {}

pub type Handle = *mut c_void;

#[inline]
pub unsafe fn get_sym(handle: Handle, name: &CStr) -> Result<*mut (), Error> {
    unsafe {
        let _lock = lock_dlerror_mutex();
        //clear the dlerror in order to be able to distinguish between NULL pointer and error
        let _ = dlerror();
        let symbol = dlsym(handle, name.as_ptr());
        //This can be either error or just the library has a NULL pointer - legal
        if symbol.is_null() {
            let msg = dlerror();
            if !msg.is_null() {
                return Err(Error::SymbolGettingError(IoError::other(
                    CStr::from_ptr(msg).to_string_lossy().to_string(),
                )));
            }
        }
        Ok(symbol as *mut ())
    }
}

#[inline]
pub unsafe fn open_self() -> Result<Handle, Error> {
    unsafe {
        let _lock = lock_dlerror_mutex();
        let handle = dlopen(null(), DEFAULT_FLAGS);
        if handle.is_null() {
            Err(Error::OpeningLibraryError(IoError::other(
                CStr::from_ptr(dlerror()).to_string_lossy().to_string(),
            )))
        } else {
            Ok(handle)
        }
    }
}

#[inline]
pub unsafe fn open_lib(name: &OsStr, flags: Option<i32>) -> Result<Handle, Error> {
    unsafe {
        let mut v: Vec<u8> = Vec::new();
        //as_bytes i a unix-specific extension
        let cstr = if !name.is_empty() && name.as_bytes()[name.len() - 1] == 0 {
            //don't need to convert
            CStr::from_bytes_with_nul_unchecked(name.as_bytes())
        } else {
            //need to convert
            v.extend_from_slice(name.as_bytes());
            v.push(0);
            CStr::from_bytes_with_nul_unchecked(v.as_slice())
        };
        let _lock = lock_dlerror_mutex();
        let handle = dlopen(cstr.as_ptr(), flags.unwrap_or(DEFAULT_FLAGS));
        if handle.is_null() {
            Err(Error::OpeningLibraryError(IoError::other(
                CStr::from_ptr(dlerror()).to_string_lossy().to_string(),
            )))
        } else {
            Ok(handle)
        }
    }
}

#[inline]
pub unsafe fn addr_info_init() {}
#[inline]
pub unsafe fn addr_info_cleanup() {}

use std::mem::MaybeUninit;
#[inline]
pub fn addr_info_obtain(addr: *const ()) -> Result<AddressInfo, Error> {
    // let mut dlinfo: Dl_info = unsafe{uninitialized()};
    let mut dlinfo = MaybeUninit::<Dl_info>::uninit();
    let result = unsafe { dladdr(addr as *const c_void, dlinfo.as_mut_ptr()) };
    if result == 0 {
        Err(Error::AddrNotMatchingDll(IoError::new(
            ErrorKind::NotFound,
            String::new(),
        )))
    } else {
        let dlinfo = unsafe { dlinfo.assume_init() };
        let os = if dlinfo.dli_saddr.is_null() || dlinfo.dli_sname.is_null() {
            None
        } else {
            Some(OverlappingSymbol {
                addr: dlinfo.dli_saddr as *const (),
                name: unsafe {
                    CStr::from_ptr(dlinfo.dli_sname)
                        .to_string_lossy()
                        .into_owned()
                },
            })
        };
        Ok(AddressInfo {
            dll_path: unsafe {
                CStr::from_ptr(dlinfo.dli_fname)
                    .to_string_lossy()
                    .into_owned()
            },
            dll_base_addr: dlinfo.dli_fbase as *const (),
            overlapping_symbol: os,
        })
    }
}

#[inline]
pub fn close_lib(handle: Handle) -> Handle {
    let result = unsafe { dlclose(handle) };
    if result != 0 {
        panic!("Call to dlclose() failed");
    }
    null_mut()
}
