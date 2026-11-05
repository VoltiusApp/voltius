use super::acl::{self, Ace, POLICY_DIR_SDDL};
use super::{Blocked, Guard};
use crate::win_security::{sid_string, wide, SecurityDescriptor};
use std::fs::File;
use std::io;
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::os::windows::io::AsRawHandle;
use std::path::Path;
use std::ptr;
use windows_sys::Win32::Foundation::{
    ERROR_INVALID_OWNER, ERROR_PRIVILEGE_NOT_HELD, ERROR_SUCCESS, WIN32_ERROR,
};
use windows_sys::Win32::Security::Authorization::{GetSecurityInfo, SE_FILE_OBJECT};
use windows_sys::Win32::Security::{
    GetAce, SetKernelObjectSecurity, ACCESS_ALLOWED_ACE, ACL, DACL_SECURITY_INFORMATION,
    OWNER_SECURITY_INFORMATION, PSID,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateDirectoryW, FILE_ATTRIBUTE_REPARSE_POINT, FILE_FLAG_BACKUP_SEMANTICS,
    FILE_FLAG_OPEN_REPARSE_POINT, FILE_READ_ATTRIBUTES, READ_CONTROL, WRITE_DAC, WRITE_OWNER,
};

fn denied_if_not_admin(e: io::Error) -> io::Error {
    match e.raw_os_error().map(|c| c as WIN32_ERROR) {
        Some(ERROR_INVALID_OWNER | ERROR_PRIVILEGE_NOT_HELD) => {
            io::Error::new(io::ErrorKind::PermissionDenied, e)
        }
        _ => e,
    }
}

// Opens the entry itself, never a reparse target, so the link check and the ACL call see one object.
fn open_entry(path: &Path, access: u32) -> io::Result<File> {
    std::fs::OpenOptions::new()
        .access_mode(access | FILE_READ_ATTRIBUTES)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
}

fn is_link(f: &File) -> io::Result<bool> {
    Ok(f.metadata()?.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0)
}

pub fn probe(path: &Path) -> io::Result<Guard> {
    let f = match open_entry(path, READ_CONTROL) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Guard::Missing),
        r => r?,
    };
    Ok(if is_link(&f)? {
        Guard::Link
    } else if is_admin_protected(&f)? {
        Guard::Protected
    } else {
        Guard::Unprotected
    })
}

pub fn harden(policy_file: &Path) -> Result<(), Blocked> {
    let io_at = |p: &Path| {
        let p = p.to_path_buf();
        move |e: io::Error| Blocked::Io(p, denied_if_not_admin(e))
    };
    let dir = policy_file.parent().unwrap_or(policy_file);
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent).map_err(io_at(parent))?;
    }
    let sd = SecurityDescriptor::from_sddl(POLICY_DIR_SDDL).map_err(io_at(dir))?;
    let sa = sd.attributes();
    if unsafe { CreateDirectoryW(wide(dir).as_ptr(), &sa) } == 0 {
        let e = io::Error::last_os_error();
        if e.kind() != io::ErrorKind::AlreadyExists {
            return Err(io_at(dir)(e));
        }
    }
    apply(dir, &sd)?;
    match apply(policy_file, &sd) {
        Err(Blocked::Io(_, e)) if e.kind() == io::ErrorKind::NotFound => Ok(()),
        r => r,
    }
}

// SetKernelObjectSecurity does not propagate to children, so links planted inside the folder are never followed.
fn apply(path: &Path, sd: &SecurityDescriptor) -> Result<(), Blocked> {
    let io_err = |e: io::Error| Blocked::Io(path.to_path_buf(), denied_if_not_admin(e));
    let f = open_entry(path, READ_CONTROL | WRITE_DAC | WRITE_OWNER).map_err(io_err)?;
    if is_link(&f).map_err(io_err)? {
        return Err(Blocked::Link(path.to_path_buf()));
    }
    let ok = unsafe {
        SetKernelObjectSecurity(
            f.as_raw_handle(),
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            sd.as_ptr(),
        )
    };
    if ok == 0 {
        return Err(io_err(io::Error::last_os_error()));
    }
    Ok(())
}

fn is_admin_protected(f: &File) -> io::Result<bool> {
    let mut owner: PSID = ptr::null_mut();
    let mut dacl: *mut ACL = ptr::null_mut();
    let mut sd = SecurityDescriptor::null();
    unsafe {
        let code = GetSecurityInfo(
            f.as_raw_handle(),
            SE_FILE_OBJECT,
            OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION,
            &mut owner,
            ptr::null_mut(),
            &mut dacl,
            ptr::null_mut(),
            sd.out(),
        );
        if code != ERROR_SUCCESS {
            return Err(io::Error::from_raw_os_error(code as i32));
        }
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
