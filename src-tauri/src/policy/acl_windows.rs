use super::acl::{self, Ace, FolderAction, POLICY_DIR_SDDL};
use super::{Blocked, Entry, Guard};
use crate::win_security::{
    create_new_with, current_user_sid, map_dacl, security_info, sid_string, wide,
    SecurityDescriptor,
};
use std::fs::File;
use std::io::{self, Read};
use std::os::windows::fs::OpenOptionsExt;
use std::os::windows::io::AsRawHandle;
use std::path::{Path, PathBuf};
use windows_sys::Win32::Foundation::{ERROR_INVALID_OWNER, ERROR_PRIVILEGE_NOT_HELD, WIN32_ERROR};
use windows_sys::Win32::Security::Authorization::SE_FILE_OBJECT;
use windows_sys::Win32::Security::{
    SetKernelObjectSecurity, ACL, DACL_SECURITY_INFORMATION, OBJECT_SECURITY_INFORMATION,
    OWNER_SECURITY_INFORMATION, PSID,
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

pub fn harden_dir(policy_file: &Path) -> Result<Option<PathBuf>, Blocked> {
    let dir = policy_file.parent().unwrap_or(policy_file);
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent).map_err(io_at(parent))?;
    }
    let sd = SecurityDescriptor::from_sddl(POLICY_DIR_SDDL).map_err(io_at(dir))?;
    let mut moved = None;
    if !create_dir(dir, &sd).map_err(io_at(dir))? {
        let owner = owner_of(&open_unlinked(dir, READ_CONTROL)?).map_err(io_at(dir))?;
        if acl::folder_action(owner.as_deref()) == FolderAction::Replace {
            moved = Some(move_aside(dir, &sd)?);
        }
    }
    apply(dir, &sd, |_| Ok(true))?;
    Ok(moved)
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

fn move_aside(dir: &Path, sd: &SecurityDescriptor) -> Result<PathBuf, Blocked> {
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
        Ok(true) => Ok(aside),
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

fn security(
    f: &File,
    info: OBJECT_SECURITY_INFORMATION,
) -> io::Result<(PSID, *mut ACL, SecurityDescriptor)> {
    security_info(f.as_raw_handle(), SE_FILE_OBJECT, info)
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
    let aces = unsafe { map_dacl(dacl, |t, f, m, sid| Ace::from_raw(t, f, m, sid)) }?;
    aces.map(|aces| Ok((unsafe { sid_string(owner) }?, aces)))
        .transpose()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::win_security::{security_of, SecurityInfo};
    use std::collections::BTreeSet;

    const SYSTEM: &str = "S-1-5-18";
    const ADMINS: &str = "S-1-5-32-544";
    const USERS: &str = "S-1-5-32-545";
    const INHERITED_ACE: u8 = 0x10;
    const CONTENT: &str = "{\"version\":1}";

    struct Scratch(tempfile::TempDir);

    impl Scratch {
        fn new(name: &str) -> Self {
            Scratch(
                tempfile::Builder::new()
                    .prefix(&format!("voltius-acl-{name}-"))
                    .tempdir()
                    .unwrap(),
            )
        }

        fn policy_file(&self) -> PathBuf {
            self.0.path().join("Voltius").join("policy.json")
        }

        fn junction(&self, link: &Path, target: &Path) {
            let status = std::process::Command::new("cmd")
                .args(["/c", "mklink", "/J"])
                .arg(link)
                .arg(target)
                .output()
                .unwrap()
                .status;
            assert!(status.success(), "mklink /J failed");
        }
    }

    fn security_at(path: &Path) -> SecurityInfo {
        let f = open_entry(path, READ_CONTROL).unwrap();
        security_of(f.as_raw_handle(), SE_FILE_OBJECT).unwrap()
    }

    fn assert_admin_only(path: &Path) {
        let info = security_at(path);
        assert!(
            [ADMINS, SYSTEM].contains(&info.owner.as_str()),
            "owner {}",
            info.owner
        );
        assert!(info.protected, "DACL not protected: {info:?}");
        assert!(info.aces.iter().all(|a| a.ace_type == 0), "{info:?}");
        assert!(
            info.aces.iter().all(|a| a.flags & INHERITED_ACE == 0),
            "{info:?}"
        );
        let sids: BTreeSet<&str> = info.aces.iter().map(|a| a.sid.as_str()).collect();
        assert_eq!(sids, BTreeSet::from([SYSTEM, ADMINS, USERS]), "{info:?}");
    }

    #[test]
    fn hardened_folder_is_protected_and_admin_owned() {
        let s = Scratch::new("harden");
        let policy_file = s.policy_file();
        assert!(matches!(harden_dir(&policy_file), Ok(None)));
        let dir = policy_file.parent().unwrap();
        assert_eq!(probe(dir).unwrap().guard, Guard::Protected);
        assert_admin_only(dir);
    }

    #[test]
    fn written_file_is_adopted_and_read_back() {
        let s = Scratch::new("adopt");
        let policy_file = s.policy_file();
        assert!(matches!(harden_dir(&policy_file), Ok(None)));
        write(&policy_file, CONTENT).unwrap();
        assert!(adopt_written(&policy_file).is_ok());
        let entry = probe(&policy_file).unwrap();
        assert_eq!(entry.guard, Guard::Protected);
        assert_eq!(entry.text.unwrap().unwrap(), CONTENT);
        assert_admin_only(&policy_file);
    }

    #[test]
    fn links_are_seen_on_the_entry_itself() {
        let s = Scratch::new("links");
        let target_dir = s.0.path().join("target-dir");
        std::fs::create_dir(&target_dir).unwrap();
        let junction = s.0.path().join("junction");
        s.junction(&junction, &target_dir);
        assert_eq!(probe(&junction).unwrap().guard, Guard::Link);

        let plain = s.0.path().join("plain.txt");
        std::fs::write(&plain, "x").unwrap();
        let symlink = s.0.path().join("symlink.txt");
        std::os::windows::fs::symlink_file(&plain, &symlink).unwrap();
        assert_eq!(probe(&symlink).unwrap().guard, Guard::Link);

        let hard = s.0.path().join("hard.txt");
        std::fs::hard_link(&plain, &hard).unwrap();
        assert!(probe(&hard).unwrap().hard_linked);
    }

    #[test]
    fn harden_refuses_a_linked_folder() {
        let s = Scratch::new("refuse");
        let target_dir = s.0.path().join("target-dir");
        std::fs::create_dir(&target_dir).unwrap();
        let policy_file = s.policy_file();
        std::fs::create_dir_all(policy_file.parent().unwrap().parent().unwrap()).unwrap();
        s.junction(policy_file.parent().unwrap(), &target_dir);

        let before = security_at(&target_dir);
        assert!(matches!(harden_dir(&policy_file), Err(Blocked::Link(_))));
        assert_eq!(security_at(&target_dir), before);
    }
}
