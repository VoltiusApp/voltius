use std::io;
use std::os::windows::ffi::OsStrExt;
use std::ptr;
use windows_sys::Win32::Foundation::LocalFree;
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, SDDL_REVISION_1,
};
use windows_sys::Win32::Security::{PSECURITY_DESCRIPTOR, PSID};

pub fn wide(s: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    s.as_ref().encode_wide().chain(std::iter::once(0)).collect()
}

pub struct SecurityDescriptor(pub PSECURITY_DESCRIPTOR);

impl SecurityDescriptor {
    pub fn from_sddl(sddl: &str) -> io::Result<Self> {
        let mut psd: PSECURITY_DESCRIPTOR = ptr::null_mut();
        let ok = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                wide(sddl).as_ptr(),
                SDDL_REVISION_1,
                &mut psd,
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(SecurityDescriptor(psd))
    }
}

impl Drop for SecurityDescriptor {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { LocalFree(self.0.cast()) };
        }
    }
}

/// # Safety
/// `sid` must point to a valid SID.
pub unsafe fn sid_string(sid: PSID) -> io::Result<String> {
    let mut raw: *mut u16 = ptr::null_mut();
    if ConvertSidToStringSidW(sid, &mut raw) == 0 {
        return Err(io::Error::last_os_error());
    }
    let mut n = 0usize;
    while *raw.add(n) != 0 {
        n += 1;
    }
    let s = String::from_utf16_lossy(std::slice::from_raw_parts(raw, n));
    LocalFree(raw.cast());
    Ok(s)
}
