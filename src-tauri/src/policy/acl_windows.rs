use super::acl::{self, Ace, POLICY_DIR_SDDL};
use super::{Blocked, Entry, Guard};
use crate::win_security::{
    create_new_with, current_user_sid, sid_string, wide, SecurityDescriptor,
};
use std::fs::File;
use std::io::{self, Read};
use std::os::windows::fs::OpenOptionsExt;
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
    CreateDirectoryW, GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT, FILE_GENERIC_READ,
    FILE_READ_ATTRIBUTES, READ_CONTROL, WRITE_DAC, WRITE_OWNER,
};

fn denied_if_not_admin(e: io::Error) -> io::Error {
    match e.raw_os_error().map(|c| c as WIN32_ERROR) {
        Some(ERROR_INVALID_OWNER | ERROR_PRIVILEGE_NOT_HELD) => {
            io::Error::new(io::ErrorKind::PermissionDenied, e)
        }
        _ => e,
    }
}

fn io_at(path: &Path) -> impl Fn(io::Error) -> Blocked + '_ {
    move |e| Blocked::Io(path.to_path_buf(), denied_if_not_admin(e))
}

// Opens the entry itself, never a reparse target, so the link check and the ACL call see one object.
fn open_entry(path: &Path, access: u32) -> io::Result<File> {
    std::fs::OpenOptions::new()
        .access_mode(access | FILE_READ_ATTRIBUTES)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
}

fn file_info(f: &File) -> io::Result<BY_HANDLE_FILE_INFORMATION> {
    let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
    if unsafe { GetFileInformationByHandle(f.as_raw_handle(), &mut info) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(info)
}

pub fn probe(path: &Path) -> io::Result<Entry> {
    let mut f = match open_entry(path, FILE_GENERIC_READ) {
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Entry::new(Guard::Missing)),
        r => r?,
    };
    let info = file_info(&f)?;
    if acl::is_reparse(info.dwFileAttributes) {
        return Ok(Entry::new(Guard::Link));
    }
    let hard_linked = acl::is_hard_linked(info.dwFileAttributes, info.nNumberOfLinks);
    if !read_acl(&f)?.is_some_and(|(owner, aces)| acl::admin_protected(&owner, &aces)) {
        return Ok(Entry {
            hard_linked,
            ..Entry::new(Guard::Unprotected)
        });
    }
    let text = if acl::is_dir(info.dwFileAttributes) {
        None
    } else {
        let mut bytes = Vec::new();
        f.read_to_end(&mut bytes)?;
        Some(String::from_utf8_lossy(&bytes).into_owned())
    };
    Ok(Entry {
        guard: Guard::Protected,
        hard_linked,
        text,
    })
}

pub fn harden_dir(policy_file: &Path) -> Result<(), Blocked> {
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
    apply(dir, &sd, |_| Ok(true))
}

pub fn write(policy_file: &Path, text: &str) -> io::Result<()> {
    let sd = SecurityDescriptor::from_sddl(&acl::file_sddl())?;
    super::write_text_atomic_via(policy_file, text, |tmp| create_new_with(tmp, &sd))
        .map_err(denied_if_not_admin)
}

pub fn adopt_written(policy_file: &Path) -> Result<(), Blocked> {
    let sd = SecurityDescriptor::from_sddl(&acl::file_sddl()).map_err(io_at(policy_file))?;
    let us = current_user_sid().map_err(io_at(policy_file))?;
    apply(policy_file, &sd, |f| {
        Ok(read_acl(f)?.is_some_and(|(owner, aces)| acl::written_by_us(&owner, &aces, &us)))
    })
}

// SetKernelObjectSecurity does not propagate to children, so links planted inside the folder are never followed.
fn apply(
    path: &Path,
    sd: &SecurityDescriptor,
    accept: impl FnOnce(&File) -> io::Result<bool>,
) -> Result<(), Blocked> {
    let io_err = io_at(path);
    let f = open_entry(path, READ_CONTROL | WRITE_DAC | WRITE_OWNER).map_err(&io_err)?;
    let info = file_info(&f).map_err(&io_err)?;
    if acl::is_reparse(info.dwFileAttributes)
        || acl::is_hard_linked(info.dwFileAttributes, info.nNumberOfLinks)
    {
        return Err(Blocked::Link(path.to_path_buf()));
    }
    if !accept(&f).map_err(&io_err)? {
        return Err(Blocked::Unprotected(path.to_path_buf()));
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

fn read_acl(f: &File) -> io::Result<Option<(String, Vec<Ace>)>> {
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
            return Ok(None);
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
                None => return Ok(None),
            }
        }
        Ok(Some((sid_string(owner)?, aces)))
    }
}
