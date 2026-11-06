use std::ffi::OsString;
use std::io;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::path::PathBuf;
use std::ptr;
use windows_sys::Win32::Foundation::{LocalFree, ERROR_SUCCESS, HANDLE};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo,
    SDDL_REVISION_1, SE_OBJECT_TYPE,
};
use windows_sys::Win32::Security::{
    ACL, OBJECT_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SECURITY_ATTRIBUTES,
};
use windows_sys::Win32::System::Com::CoTaskMemFree;
use windows_sys::Win32::UI::Shell::{FOLDERID_ProgramData, SHGetKnownFolderPath};

pub fn wide(s: impl AsRef<std::ffi::OsStr>) -> Vec<u16> {
    s.as_ref().encode_wide().chain(std::iter::once(0)).collect()
}

unsafe fn from_wide_ptr(raw: *const u16) -> OsString {
    let mut n = 0usize;
    while *raw.add(n) != 0 {
        n += 1;
    }
    OsString::from_wide(std::slice::from_raw_parts(raw, n))
}

pub struct SecurityDescriptor(PSECURITY_DESCRIPTOR);

impl SecurityDescriptor {
    pub(crate) fn null() -> Self {
        SecurityDescriptor(ptr::null_mut())
    }

    pub fn from_sddl(sddl: &str) -> io::Result<Self> {
        let mut sd = Self::null();
        let ok = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                wide(sddl).as_ptr(),
                SDDL_REVISION_1,
                sd.out(),
                ptr::null_mut(),
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(sd)
    }

    pub fn as_ptr(&self) -> PSECURITY_DESCRIPTOR {
        self.0
    }

    pub fn out(&mut self) -> *mut PSECURITY_DESCRIPTOR {
        &mut self.0
    }

    pub fn attributes(&self) -> SECURITY_ATTRIBUTES {
        SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: self.0,
            bInheritHandle: 0,
        }
    }
}

impl Drop for SecurityDescriptor {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { LocalFree(self.0.cast()) };
        }
    }
}

pub fn create_new_with(
    path: &std::path::Path,
    sd: &SecurityDescriptor,
) -> io::Result<std::fs::File> {
    use std::os::windows::io::FromRawHandle;
    use windows_sys::Win32::Foundation::{GENERIC_WRITE, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{CreateFileW, CREATE_NEW, FILE_ATTRIBUTE_NORMAL};

    let sa = sd.attributes();
    let handle = unsafe {
        CreateFileW(
            wide(path).as_ptr(),
            GENERIC_WRITE,
            0,
            &sa,
            CREATE_NEW,
            FILE_ATTRIBUTE_NORMAL,
            ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    Ok(unsafe { std::fs::File::from_raw_handle(handle) })
}

/// The returned SID and ACL point into the descriptor, which must outlive them.
pub fn security_info(
    handle: HANDLE,
    kind: SE_OBJECT_TYPE,
    info: OBJECT_SECURITY_INFORMATION,
) -> io::Result<(PSID, *mut ACL, SecurityDescriptor)> {
    let mut owner: PSID = ptr::null_mut();
    let mut dacl: *mut ACL = ptr::null_mut();
    let mut sd = SecurityDescriptor::null();
    let code = unsafe {
        GetSecurityInfo(
            handle,
            kind,
            info,
            &mut owner,
            ptr::null_mut(),
            &mut dacl,
            ptr::null_mut(),
            sd.out(),
        )
    };
    if code != ERROR_SUCCESS {
        return Err(io::Error::from_raw_os_error(code as i32));
    }
    Ok((owner, dacl, sd))
}

#[cfg(test)]
pub fn sddl_of(handle: HANDLE, kind: SE_OBJECT_TYPE) -> io::Result<String> {
    use windows_sys::Win32::Security::Authorization::ConvertSecurityDescriptorToStringSecurityDescriptorW;
    use windows_sys::Win32::Security::{DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION};

    let info = OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;
    let (_, _, sd) = security_info(handle, kind, info)?;
    let mut raw: *mut u16 = ptr::null_mut();
    let ok = unsafe {
        ConvertSecurityDescriptorToStringSecurityDescriptorW(
            sd.as_ptr(),
            SDDL_REVISION_1,
            info,
            &mut raw,
            ptr::null_mut(),
        )
    };
    if ok == 0 {
        return Err(io::Error::last_os_error());
    }
    let s = unsafe { from_wide_ptr(raw) }.to_string_lossy().into_owned();
    unsafe { LocalFree(raw.cast()) };
    Ok(s)
}

/// # Safety
/// `sid` must point to a valid SID.
pub unsafe fn sid_string(sid: PSID) -> io::Result<String> {
    let mut raw: *mut u16 = ptr::null_mut();
    if ConvertSidToStringSidW(sid, &mut raw) == 0 {
        return Err(io::Error::last_os_error());
    }
    let s = from_wide_ptr(raw).to_string_lossy().into_owned();
    LocalFree(raw.cast());
    Ok(s)
}

/// The process token's user SID in string form (`S-1-5-21-…`).
pub fn current_user_sid() -> io::Result<String> {
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_QUERY, TOKEN_USER};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    unsafe {
        let mut token: HANDLE = ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(io::Error::last_os_error());
        }
        // Two calls, deliberately: the first learns the size. A single call
        // with a guessed size returns ERROR_INSUFFICIENT_BUFFER and no SID.
        let mut len = 0u32;
        GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut len);
        // u64, not u8: TOKEN_USER needs 8-byte alignment and a Vec<u8> is
        // align-1, so reading `(*user).User.Sid` out of it is a misaligned
        // deref — UB by Rust's rules even where the hardware tolerates it.
        let mut buf = vec![0u64; (len as usize).div_ceil(8)];
        let ok = GetTokenInformation(token, TokenUser, buf.as_mut_ptr().cast(), len, &mut len) != 0;
        let err = io::Error::last_os_error();
        CloseHandle(token);
        if !ok {
            return Err(err);
        }
        let user: *const TOKEN_USER = buf.as_ptr().cast();
        sid_string((*user).User.Sid)
    }
}

pub fn program_data() -> Option<PathBuf> {
    let mut raw: *mut u16 = ptr::null_mut();
    unsafe {
        let hr = SHGetKnownFolderPath(&FOLDERID_ProgramData, 0, ptr::null_mut(), &mut raw);
        let path = (hr >= 0 && !raw.is_null()).then(|| PathBuf::from(from_wide_ptr(raw)));
        CoTaskMemFree(raw.cast());
        path
    }
}
