//! Raw System Call Wrappers
//!
use super::types::{KeyCtlOperation, KeySerialId, KeyType};
use crate::KeyError;
use alloc::ffi::CString;
use core::ffi::CStr;

/// add_key() creates or updates a key of the given type and description, instantiates
/// it with the payload of length plen, attaches it to the nominated keyring, and
/// returns the key's serial number.
///
/// The key may be rejected if the provided data is in the wrong format or it is invalid
/// in some other way. If the destination keyring already contains a key that matches the
/// specified type and description, then, if the key type supports it, that key will be
/// updated rather than a new key being created; if not, a new key (with a different ID)
/// will be created and it will displace the link to the extant key from the keyring.
///
/// The destination keyring serial number may be that of a valid keyring for which the
/// caller has write  permission.  Alternatively, it may be one of the following special
/// keyring IDs:
pub(crate) fn add_key(
    ktype: KeyType,
    keyring: libc::c_ulong,
    description: &str,
    payload: Option<&[u8]>,
) -> Result<KeySerialId, KeyError> {
    // Perform conversion into a c string
    let description = CString::new(description).or(Err(KeyError::InvalidDescription))?;

    // When creating keyrings the payload will be NULL
    let (payload, plen) = match payload {
        Some(p) => (p.as_ptr(), p.len()),
        None => (core::ptr::null(), 0),
    };

    // Perform the actual system call
    let res = unsafe {
        libc::syscall(
            libc::SYS_add_key,
            Into::<&'static CStr>::into(ktype).as_ptr(),
            description.as_ptr(),
            payload,
            plen as libc::size_t,
            keyring as u32,
        )
    };

    // Return the underlying error
    if res < 0 {
        return Err(KeyError::from_errno());
    }

    // Otherwise return the ID
    Ok(KeySerialId::new(
        res.try_into().or(Err(KeyError::InvalidIdentifier))?,
    ))
}

/// request_key() attempts to find a key of the given type with a description that
/// matches the specified description. If such a key could not be found, then
/// the key is optionally created.
///
/// If the key is found or created, request_key() attaches it to the keyring
/// and returns the key's serial number.
///
/// request_key() first recursively searches for a matching key in all of the keyrings
/// attached to the calling process. The keyrings are searched in the order:
/// thread-specific keyring, process-specific keyring, and then session keyring.
///
/// If request_key() is called from a program invoked by request_key() on behalf
/// of some other process to generate a key, then the keyrings of that other process
/// will be searched next, using that other process's user ID, group ID, supplementary
/// group IDs, and security context to determine access.
///
/// The search of the keyring tree is breadth-first: the keys in each keyring searched
/// are checked for a match before any child keyrings are recursed into. Only keys for
/// which the caller has search permission be found, and only keyrings for which the
/// caller has search permission may be searched.
///
/// If the key is not found and callout info is empty then the call fails with the
/// error ENOKEY.
///
/// If the key is not found and callout info is not empty, then the kernel attempts
/// to invoke a user-space program to instantiate the key.
pub(crate) fn request_key(
    ktype: KeyType,
    keyring: libc::c_ulong,
    description: &str,
    info: Option<&str>,
) -> Result<KeySerialId, KeyError> {
    // Perform conversion into a c string
    let description = CString::new(description).or(Err(KeyError::InvalidDescription))?;
    let callout = CString::new(info.unwrap_or("")).or(Err(KeyError::InvalidDescription))?;

    // Perform the actual system call. By setting callout to NULL the kernel will
    // not invoke /sbin/request-key
    let res = unsafe {
        libc::syscall(
            libc::SYS_request_key,
            Into::<&'static CStr>::into(ktype).as_ptr(),
            description.as_ptr(),
            info.map_or_else(core::ptr::null, |_| callout.as_ptr()),
            keyring as u32,
        )
    };

    // Return the underlying error
    if res < 0 {
        return Err(KeyError::from_errno());
    }

    // Otherwise return the ID
    Ok(KeySerialId::new(
        res.try_into().or(Err(KeyError::InvalidIdentifier))?,
    ))
}

/// keyctl() allows user-space programs to perform key manipulation.
///
/// The operation performed by keyctl() is determined by the value of the operation argument.
/// Each of these operations is wrapped by the KeyCtl interface (provided by the this crate)
/// into individual functions (noted below) to permit the compiler to check types.
pub(crate) fn keyctl_impl(
    operation: KeyCtlOperation,
    arg2: libc::c_ulong,
    arg3: libc::c_ulong,
    arg4: libc::c_ulong,
    arg5: libc::c_ulong,
) -> Result<libc::c_long, KeyError> {
    // Perform the actual system call
    let res = unsafe { libc::syscall(libc::SYS_keyctl, operation as u32, arg2, arg3, arg4, arg5) };

    // Return the underlying error
    if res < 0 {
        return Err(KeyError::from_errno());
    }

    // Otherwise return the result
    Ok(res)
}
