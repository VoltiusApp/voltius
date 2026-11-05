#[derive(Clone, Debug, PartialEq)]
pub struct Ace {
    pub sid: String,
    pub mask: u32,
    pub allow: bool,
    pub inherit_only: bool,
}

pub const ADMIN_SIDS: [&str; 3] = [
    "S-1-5-18",
    "S-1-5-32-544",
    "S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464",
];

pub const WRITE_MASK: u32 =
    0x0002 | 0x0004 | 0x0040 | 0x0001_0000 | 0x0004_0000 | 0x0008_0000 | 0x4000_0000 | 0x1000_0000;

pub const POLICY_DIR_SDDL: &str = "O:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;0x1200a9;;;BU)";

const ACCESS_ALLOWED: u8 = 0;
const ACCESS_DENIED: u8 = 1;
const ACCESS_ALLOWED_CALLBACK: u8 = 9;
const ACCESS_DENIED_CALLBACK: u8 = 10;
const INHERIT_ONLY: u8 = 0x08;

impl Ace {
    /// `None` for ACE types whose SID isn't at the plain ACE offset; callers treat that as unprotected.
    pub fn from_raw(
        ace_type: u8,
        flags: u8,
        mask: u32,
        sid: impl FnOnce() -> std::io::Result<String>,
    ) -> std::io::Result<Option<Ace>> {
        let allow = match ace_type {
            ACCESS_ALLOWED | ACCESS_ALLOWED_CALLBACK => true,
            ACCESS_DENIED | ACCESS_DENIED_CALLBACK => false,
            _ => return Ok(None),
        };
        Ok(Some(Ace {
            sid: sid()?,
            mask,
            allow,
            inherit_only: flags & INHERIT_ONLY != 0,
        }))
    }
}

fn is_admin(sid: &str) -> bool {
    ADMIN_SIDS.contains(&sid)
}

fn only_admins_write(aces: &[Ace]) -> bool {
    !aces
        .iter()
        .any(|a| a.allow && !a.inherit_only && a.mask & WRITE_MASK != 0 && !is_admin(&a.sid))
}

pub fn admin_protected(owner: &str, aces: &[Ace]) -> bool {
    is_admin(owner) && only_admins_write(aces)
}

pub fn written_by_us(owner: &str, aces: &[Ace], our_sid: &str) -> bool {
    (is_admin(owner) || owner == our_sid) && only_admins_write(aces)
}

const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;

pub fn is_dir(attributes: u32) -> bool {
    attributes & FILE_ATTRIBUTE_DIRECTORY != 0
}

pub fn is_reparse(attributes: u32) -> bool {
    attributes & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

pub fn is_hard_linked(attributes: u32, links: u32) -> bool {
    !is_dir(attributes) && links > 1
}

pub fn file_sddl() -> String {
    POLICY_DIR_SDDL.replace(";OICI;", ";;")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SYSTEM: &str = "S-1-5-18";
    const ADMINS: &str = "S-1-5-32-544";
    const USERS: &str = "S-1-5-32-545";
    const CREATOR_OWNER: &str = "S-1-3-0";
    const EVERYONE: &str = "S-1-1-0";
    const SOME_USER: &str = "S-1-5-21-1004336348-1177238915-682003330-1001";
    const FULL: u32 = 0x001F_01FF;
    const READ_EXECUTE: u32 = 0x0012_00A9;

    fn allow(sid: &str, mask: u32) -> Ace {
        Ace {
            sid: sid.into(),
            mask,
            allow: true,
            inherit_only: false,
        }
    }

    fn hardened() -> Vec<Ace> {
        vec![
            allow(SYSTEM, FULL),
            allow(ADMINS, FULL),
            allow(USERS, READ_EXECUTE),
        ]
    }

    #[test]
    fn default_programdata_acl_is_unprotected() {
        let mut aces = hardened();
        aces.push(Ace {
            inherit_only: true,
            ..allow(CREATOR_OWNER, 0x1000_0000)
        });
        aces.push(allow(USERS, 0x0006));
        assert!(!admin_protected(ADMINS, &aces));
    }

    #[test]
    fn hardened_acl_is_protected() {
        assert!(admin_protected(ADMINS, &hardened()));
        assert!(admin_protected(SYSTEM, &hardened()));
    }

    #[test]
    fn user_owner_is_unprotected() {
        assert!(!admin_protected(SOME_USER, &hardened()));
    }

    #[test]
    fn inherit_only_creator_owner_ignored() {
        let mut aces = hardened();
        aces.push(Ace {
            inherit_only: true,
            ..allow(CREATOR_OWNER, 0x1000_0000)
        });
        assert!(admin_protected(ADMINS, &aces));
        aces.push(allow(CREATOR_OWNER, 0x1000_0000));
        assert!(!admin_protected(ADMINS, &aces));
    }

    #[test]
    fn deny_ace_ignored() {
        let mut aces = hardened();
        aces.push(Ace {
            allow: false,
            ..allow(EVERYONE, FULL)
        });
        assert!(admin_protected(ADMINS, &aces));
    }

    #[test]
    fn each_write_bit_for_a_non_admin_is_unprotected() {
        for bit in (0..32).map(|b| 1u32 << b).filter(|b| WRITE_MASK & b != 0) {
            let mut aces = hardened();
            aces.push(allow(SOME_USER, bit));
            assert!(!admin_protected(ADMINS, &aces), "{bit:#x}");
        }
    }

    #[test]
    fn from_raw_classifies_ace_types() {
        let ace = |t, f| Ace::from_raw(t, f, FULL, || Ok(USERS.into())).unwrap();
        assert!(ace(0, 0).unwrap().allow);
        assert!(ace(9, 0).unwrap().allow);
        assert!(!ace(1, 0).unwrap().allow);
        assert!(!ace(10, 0).unwrap().allow);
        assert!(ace(0, 0x0B).unwrap().inherit_only);
        assert!(!ace(0, 0x03).unwrap().inherit_only);
        assert_eq!(ace(0, 0).unwrap().sid, USERS);
        let unknown = Ace::from_raw(5, 0, FULL, || panic!("SID read for an object ACE"));
        assert_eq!(unknown.unwrap(), None);
    }

    #[test]
    fn written_by_us_accepts_our_own_sid_but_not_a_stranger() {
        assert!(written_by_us(SOME_USER, &hardened(), SOME_USER));
        assert!(written_by_us(ADMINS, &hardened(), SOME_USER));
        assert!(!written_by_us(
            SOME_USER,
            &hardened(),
            "S-1-5-21-9-9-9-1002"
        ));
        let mut aces = hardened();
        aces.push(allow(USERS, 0x0002));
        assert!(!written_by_us(SOME_USER, &aces, SOME_USER));
    }

    #[test]
    fn reparse_points_and_hard_links_are_told_apart() {
        assert!(!is_reparse(0x20) && !is_hard_linked(0x20, 1));
        assert!(is_reparse(0x20 | 0x400));
        assert!(is_reparse(0x10 | 0x400));
        assert!(is_hard_linked(0x20, 2) && !is_reparse(0x20));
        assert!(!is_hard_linked(0x10, 3));
        assert!(is_dir(0x10) && !is_dir(0x20));
    }

    #[test]
    fn file_descriptor_is_the_folder_one_without_inheritance() {
        assert_eq!(
            file_sddl(),
            "O:BAD:P(A;;FA;;;SY)(A;;FA;;;BA)(A;;0x1200a9;;;BU)"
        );
    }
}
