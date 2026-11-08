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

/// `f` gets (type, flags, mask, lazy SID read); `None` from it aborts the walk with `None`.
///
/// # Safety
/// `dacl` must be non-null and valid, and its descriptor must outlive the call.
pub unsafe fn map_dacl<T>(
    dacl: *mut ACL,
    mut f: impl FnMut(u8, u8, u32, &dyn Fn() -> io::Result<String>) -> io::Result<Option<T>>,
) -> io::Result<Option<Vec<T>>> {
    use windows_sys::Win32::Security::{GetAce, ACCESS_ALLOWED_ACE};

    let mut out = Vec::new();
    for i in 0..unsafe { (*dacl).AceCount } {
        let mut raw = ptr::null_mut();
        if unsafe { GetAce(dacl, i.into(), &mut raw) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let ace = raw.cast::<ACCESS_ALLOWED_ACE>();
        let header = unsafe { (*ace).Header };
        let sid = || unsafe { sid_string(ptr::addr_of!((*ace).SidStart).cast_mut().cast()) };
        match f(
            header.AceType,
            header.AceFlags,
            unsafe { (*ace).Mask },
            &sid,
        )? {
            Some(item) => out.push(item),
            None => return Ok(None),
        }
    }
    Ok(Some(out))
}

#[cfg(test)]
#[derive(PartialEq, Debug)]
pub struct RawAce {
    pub ace_type: u8,
    pub flags: u8,
    pub mask: u32,
    pub sid: String,
}

#[cfg(test)]
#[derive(PartialEq, Debug)]
pub struct SecurityInfo {
    pub owner: String,
    pub protected: bool,
    pub aces: Vec<RawAce>,
}

#[cfg(test)]
pub fn security_of(handle: HANDLE, kind: SE_OBJECT_TYPE) -> io::Result<SecurityInfo> {
    use windows_sys::Win32::Security::{
        GetSecurityDescriptorControl, DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION,
        SE_DACL_PROTECTED,
    };

    let info = OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION;
    let (owner, dacl, sd) = security_info(handle, kind, info)?;
    let no_dacl = || {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "descriptor has no owner or DACL",
        )
    };
    if owner.is_null() || dacl.is_null() {
        return Err(no_dacl());
    }
    let (mut control, mut revision) = (0u16, 0u32);
    if unsafe { GetSecurityDescriptorControl(sd.as_ptr(), &mut control, &mut revision) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let aces = unsafe {
        map_dacl(dacl, |ace_type, flags, mask, sid| {
            if !matches!(ace_type, 0 | 1 | 9 | 10) {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!("ACE type {ace_type} has no plain SID at the expected offset"),
                ));
            }
            Ok(Some(RawAce {
                ace_type,
                flags,
                mask,
                sid: sid()?,
            }))
        })
    }?
    .unwrap_or_default();
    Ok(SecurityInfo {
        owner: unsafe { sid_string(owner) }?,
        protected: control & SE_DACL_PROTECTED != 0,
        aces,
    })
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

fn with_process_token<T>(f: impl FnOnce(HANDLE) -> io::Result<T>) -> io::Result<T> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::Security::TOKEN_QUERY;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    let mut token: HANDLE = ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let result = f(token);
    unsafe { CloseHandle(token) };
    result
}

/// The process token's user SID in string form (`S-1-5-21-…`).
pub fn current_user_sid() -> io::Result<String> {
    use windows_sys::Win32::Security::{GetTokenInformation, TokenUser, TOKEN_USER};

    with_process_token(|token| unsafe {
        // Two calls, deliberately: the first learns the size. A single call
        // with a guessed size returns ERROR_INSUFFICIENT_BUFFER and no SID.
        let mut len = 0u32;
        GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut len);
        // u64, not u8: TOKEN_USER needs 8-byte alignment and a Vec<u8> is
        // align-1, so reading `(*user).User.Sid` out of it is a misaligned
        // deref — UB by Rust's rules even where the hardware tolerates it.
        let mut buf = vec![0u64; (len as usize).div_ceil(8)];
        if GetTokenInformation(token, TokenUser, buf.as_mut_ptr().cast(), len, &mut len) == 0 {
            return Err(io::Error::last_os_error());
        }
        let user: *const TOKEN_USER = buf.as_ptr().cast();
        sid_string((*user).User.Sid)
    })
}

pub fn is_elevated() -> bool {
    use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION};

    with_process_token(|token| {
        let mut elevation = TOKEN_ELEVATION { TokenIsElevated: 0 };
        let mut len = 0u32;
        let ok = unsafe {
            GetTokenInformation(
                token,
                TokenElevation,
                (&mut elevation as *mut TOKEN_ELEVATION).cast(),
                std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                &mut len,
            )
        };
        Ok(ok != 0 && elevation.TokenIsElevated != 0)
    })
    .unwrap_or(false)
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

#[cfg(test)]
mod tests {
    use super::program_data;

    struct EnvRestore(Option<std::ffi::OsString>);

    impl Drop for EnvRestore {
        fn drop(&mut self) {
            match self.0.take() {
                Some(v) => std::env::set_var("ProgramData", v),
                None => std::env::remove_var("ProgramData"),
            }
        }
    }

    #[test]
    fn program_data_ignores_the_environment() {
        let _restore = EnvRestore(std::env::var_os("ProgramData"));
        std::env::set_var("ProgramData", r"Z:\not-program-data");
        let path = program_data().expect("known folder resolves");
        assert!(
            path.to_string_lossy()
                .eq_ignore_ascii_case(r"C:\ProgramData"),
            "{path:?}"
        );
    }
}
