/*!
Utilities for working with dynamic link libraries.
*/

use std::{
    ffi::{OsStr, OsString},
    mem::MaybeUninit,
};

//library naming patterns
/* Naming pattern goes as follows:
Windows *.dll
Apple	lib*.dylib
Unix	lib*.so
*/

/// This is a platform-specific file prefix.
///
/// In Unix-based systems the convention is to start the file name with "lib".
/// Windows does not have such a convention.
#[cfg(unix)]
pub const PLATFORM_FILE_PREFIX: &str = "lib";
/// This is a platform-specific file prefix.
///
/// In Unix-based systems the convention is to start the file name with "lib".
/// Windows does not have such a convention.
#[cfg(windows)]
pub const PLATFORM_FILE_PREFIX: &str = "";

/// Dynamic link library file extension specific to the platform.
#[cfg(any(target_os = "macos", target_os = "ios"))]
pub const PLATFORM_FILE_EXTENSION: &str = "dylib";
/// Dynamic link library file extension specific to the platform.
#[cfg(all(unix, not(any(target_os = "macos", target_os = "ios"))))]
pub const PLATFORM_FILE_EXTENSION: &str = "so";
/// Dynamic link library file extension specific to the platform.
#[cfg(windows)]
pub const PLATFORM_FILE_EXTENSION: &str = "dll";

/// Crates a platform-specific file name from provided core file name.
///
/// For example on Ubuntu it converts "example" argument into "libexample.so".
pub fn platform_file_name<S>(core_name: S) -> OsString
where
    S: AsRef<OsStr>,
{
    //here we operate on OStr and OsString and there are no formatting functions for them - sad
    let mut result = OsString::new();
    result.reserve_exact(
        core_name.as_ref().len() + PLATFORM_FILE_EXTENSION.len() + PLATFORM_FILE_PREFIX.len() + 1,
    );
    result.push(PLATFORM_FILE_PREFIX);
    result.push(core_name);
    result.push(".");
    result.push(PLATFORM_FILE_EXTENSION);
    result
}

pub const unsafe fn maybe_uninit_slice_assume_init_ref<T>(slice: &[MaybeUninit<T>]) -> &[T] {
    unsafe { &*(slice as *const [MaybeUninit<T>] as *const [T]) }
}

pub fn maybe_uninit_uninit_array<T, const LEN: usize>() -> [MaybeUninit<T>; LEN] {
    unsafe { MaybeUninit::<[MaybeUninit<T>; LEN]>::uninit().assume_init() }
}
