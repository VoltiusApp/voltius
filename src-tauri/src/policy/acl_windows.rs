use super::acl::{self, Ace, POLICY_DIR_SDDL};
use crate::win_security::{sid_string, wide, SecurityDescriptor};
use std::io;
use std::path::Path;
use std::ptr;
use windows_sys::Win32::Foundation::{
    BOOL, ERROR_INVALID_OWNER, ERROR_PRIVILEGE_NOT_HELD, ERROR_SUCCESS, WIN32_ERROR,
};
use windows_sys::Win32::Security::Authorization::{
    GetNamedSecurityInfoW, SetNamedSecurityInfoW, SE_FILE_OBJECT,
};
use windows_sys::Win32::Security::{
    GetAce, GetSecurityDescriptorDacl, GetSecurityDescriptorOwner, ACCESS_ALLOWED_ACE, ACL,
    DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, PROTECTED_DACL_SECURITY_INFORMATION,
    PSID, SECURITY_ATTRIBUTES,
};
use windows_sys::Win32::Storage::FileSystem::CreateDirectoryW;

fn denied_if_not_admin(e: io::Error) -> io::Error {
    match e.raw_os_error().map(|c| c as WIN32_ERROR) {
        Some(ERROR_INVALID_OWNER | ERROR_PRIVILEGE_NOT_HELD) => {
            io::Error::new(io::ErrorKind::PermissionDenied, e)
        }
        _ => e,
    }
}

fn win32(code: WIN32_ERROR) -> io::Result<()> {
    if code == ERROR_SUCCESS {
        Ok(())
    } else {
        Err(denied_if_not_admin(io::Error::from_raw_os_error(
            code as i32,
        )))
    }
}

pub fn harden(policy_file: &Path) -> io::Result<()> {
    let Some(dir) = policy_file.parent() else {
        return Ok(());
    };
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let sd = SecurityDescriptor::from_sddl(POLICY_DIR_SDDL)?;
    let sa = SECURITY_ATTRIBUTES {
        nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
        lpSecurityDescriptor: sd.0,
        bInheritHandle: 0,
    };
    if unsafe { CreateDirectoryW(wide(dir).as_ptr(), &sa) } == 0 {
        let e = io::Error::last_os_error();
        if e.kind() != io::ErrorKind::AlreadyExists {
            return Err(denied_if_not_admin(e));
        }
    }
    apply(dir, &sd)?;
    if policy_file.exists() {
        apply(policy_file, &sd)?;
    }
    Ok(())
}

fn apply(path: &Path, sd: &SecurityDescriptor) -> io::Result<()> {
    let mut owner: PSID = ptr::null_mut();
    let mut dacl: *mut ACL = ptr::null_mut();
    let (mut present, mut defaulted): (BOOL, BOOL) = (0, 0);
    unsafe {
        if GetSecurityDescriptorOwner(sd.0, &mut owner, &mut defaulted) == 0
            || GetSecurityDescriptorDacl(sd.0, &mut present, &mut dacl, &mut defaulted) == 0
        {
            return Err(io::Error::last_os_error());
        }
        win32(SetNamedSecurityInfoW(
            wide(path).as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION
                | DACL_SECURITY_INFORMATION
                | PROTECTED_DACL_SECURITY_INFORMATION,
            owner,
            ptr::null_mut(),
            dacl,
            ptr::null(),
        ))
    }
}

pub fn is_admin_protected(path: &Path) -> io::Result<bool> {
    let mut owner: PSID = ptr::null_mut();
    let mut dacl: *mut ACL = ptr::null_mut();
    let mut sd = SecurityDescriptor(ptr::null_mut());
    unsafe {
        win32(GetNamedSecurityInfoW(
            wide(path).as_ptr(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            ptr::null_mut(),
            &mut dacl,
            ptr::null_mut(),
            &mut sd.0,
        ))?;
        if owner.is_null() || dacl.is_null() {
            return Ok(false);
        }
        let mut aces = Vec::new();
        for i in 0..(*dacl).AceCount {
            let mut raw = ptr::null_mut();
            if GetAce(dacl, i.into(), &mut raw) == 0 {
                return Err(io::Error::last_os_error());
            }
            let ace = raw.cast::<ACCESS_ALLOWED_ACE>();
            let header = (*ace).Header;
            let sid = || sid_string(ptr::addr_of!((*ace).SidStart).cast_mut().cast());
            match Ace::from_raw(header.AceType, header.AceFlags, (*ace).Mask, sid)? {
                Some(entry) => aces.push(entry),
                None => return Ok(false),
            }
        }
        Ok(acl::admin_protected(&sid_string(owner)?, &aces))
    }
}
