use super::acl::{self, Ace, FolderAction, POLICY_DIR_SDDL};
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
    OBJECT_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, PSID,
};
use windows_sys::Win32::Storage::FileSystem::{
    CreateDirectoryW, GetFileInformationByHandle, MoveFileExW, BY_HANDLE_FILE_INFORMATION,
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

fn open_unlinked(path: &Path, access: u32) -> Result<File, Blocked> {
    let f = open_entry(path, access).map_err(io_at(path))?;
    let info = file_info(&f).map_err(io_at(path))?;
    if acl::is_reparse(info.dwFileAttributes)
        || acl::is_hard_linked(info.dwFileAttributes, info.nNumberOfLinks)
    {
        return Err(Blocked::Link(path.to_path_buf()));
    }
    Ok(f)
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
    let text = (!acl::is_dir(info.dwFileAttributes)).then(|| {
        let mut bytes = Vec::new();
        f.read_to_end(&mut bytes)?;
        acl::decode_text(bytes)
    });
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
    if !create_dir(dir, &sd).map_err(io_at(dir))? {
        let owner = owner_of(&open_unlinked(dir, READ_CONTROL)?).map_err(io_at(dir))?;
        if acl::folder_action(owner.as_deref()) == FolderAction::Replace {
            move_aside(dir, &sd)?;
        }
    }
    apply(dir, &sd, |_| Ok(true))
}

fn create_dir(dir: &Path, sd: &SecurityDescriptor) -> io::Result<bool> {
    let sa = sd.attributes();
    if unsafe { CreateDirectoryW(wide(dir).as_ptr(), &sa) } != 0 {
        return Ok(true);
    }
    match io::Error::last_os_error() {
        e if e.kind() == io::ErrorKind::AlreadyExists => Ok(false),
        e => Err(e),
    }
}

fn move_aside(dir: &Path, sd: &SecurityDescriptor) -> Result<(), Blocked> {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs());
    let aside = acl::untrusted_sibling(dir, secs);
    let held = || Blocked::Held(dir.to_path_buf());
    // Flags 0: never replace an existing entry; a link is renamed itself, not its target.
    if unsafe { MoveFileExW(wide(dir).as_ptr(), wide(&aside).as_ptr(), 0) } == 0 {
        return Err(held());
    }
    match create_dir(dir, sd) {
        Ok(true) => Ok(()),
        Ok(false) => Err(held()),
        Err(e) => Err(io_at(dir)(e)),
    }
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
    let f = open_unlinked(path, READ_CONTROL | WRITE_DAC | WRITE_OWNER)?;
    if !accept(&f).map_err(io_at(path))? {
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
        return Err(io_at(path)(io::Error::last_os_error()));
    }
    Ok(())
}

// The returned SID and ACL point into the descriptor, which must outlive them.
fn security(
    f: &File,
    info: OBJECT_SECURITY_INFORMATION,
) -> io::Result<(PSID, *mut ACL, SecurityDescriptor)> {
    let mut owner: PSID = ptr::null_mut();
    let mut dacl: *mut ACL = ptr::null_mut();
    let mut sd = SecurityDescriptor::null();
    let code = unsafe {
        GetSecurityInfo(
            f.as_raw_handle(),
            SE_FILE_OBJECT,
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

fn owner_of(f: &File) -> io::Result<Option<String>> {
    let (owner, _, _sd) = security(f, OWNER_SECURITY_INFORMATION)?;
    if owner.is_null() {
        return Ok(None);
    }
    unsafe { sid_string(owner) }.map(Some)
}

fn read_acl(f: &File) -> io::Result<Option<(String, Vec<Ace>)>> {
    let (owner, dacl, _sd) = security(f, OWNER_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION)?;
    if owner.is_null() || dacl.is_null() {
        return Ok(None);
    }
    unsafe {
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
