//! Changing a remote file's permission bits and owner (`chmod` / `chown`).

use crate::error::AppError;
use crate::sftp::backend::{FileBackend, TransferEvents};
use crate::ssh::exec::exit_error;
use serde::{Deserialize, Serialize};

const MODE_BITS: u32 = 0o7777;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Recurse {
    All,
    Files,
    Dirs,
}

/// Bits in `set` are turned on and bits in `clear` turned off on every path;
/// all other bits stay as each file has them.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttrChange {
    pub paths: Vec<String>,
    #[serde(default)]
    pub set: u32,
    #[serde(default)]
    pub clear: u32,
    pub owner: Option<String>,
    pub group: Option<String>,
    pub recurse: Option<Recurse>,
}

impl AttrChange {
    /// SFTP alone can only set one file's mode: owners by name and whole trees take `chown`/`chmod`.
    pub fn needs_shell(&self) -> bool {
        self.owner.is_some() || self.group.is_some() || self.recurse.is_some()
    }

    pub fn changes_mode(&self) -> bool {
        (self.set | self.clear) & MODE_BITS != 0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OwnerInfo {
    pub uid: u32,
    pub gid: u32,
    pub user: String,
    pub group: String,
}

pub fn apply_mode(current: u32, set: u32, clear: u32) -> u32 {
    (current & MODE_BITS & !clear) | (set & MODE_BITS)
}

/// `set`/`clear` as a `chmod` symbolic mode. Every clause names its class, so
/// the host's umask never filters it.
pub fn symbolic_mode(set: u32, clear: u32) -> String {
    let classes = [
        ('u', 6, 0o4000, 's'),
        ('g', 3, 0o2000, 's'),
        ('o', 0, 0, ' '),
    ];
    let letters = |bits: u32, shift: u32, special: u32, special_letter: char| {
        let mut s: String = ['r', 'w', 'x']
            .iter()
            .zip([4, 2, 1])
            .filter(|(_, b)| bits & (b << shift) != 0)
            .map(|(c, _)| *c)
            .collect();
        if special != 0 && bits & special != 0 {
            s.push(special_letter);
        }
        s
    };
    let mut clauses = Vec::new();
    for (class, shift, special, special_letter) in classes {
        for (op, bits) in [('+', set), ('-', clear)] {
            let l = letters(bits, shift, special, special_letter);
            if !l.is_empty() {
                clauses.push(format!("{class}{op}{l}"));
            }
        }
    }
    // BSD chmod only takes the sticky bit without a class.
    for (op, bits) in [('+', set), ('-', clear)] {
        if bits & 0o1000 != 0 {
            clauses.push(format!("{op}t"));
        }
    }
    clauses.join(",")
}

fn valid_name(kind: &str, name: &str) -> Result<(), String> {
    if name.is_empty()
        || name.starts_with('-')
        || name.contains(':')
        || name.chars().any(|c| c.is_whitespace() || c.is_control())
    {
        return Err(format!("Invalid {kind}: {name:?}"));
    }
    Ok(())
}

/// The `chown` operand for an owner and/or group, or None to leave both alone.
pub fn chown_spec(owner: Option<&str>, group: Option<&str>) -> Result<Option<String>, String> {
    let owner = owner.map(str::trim);
    let group = group.map(str::trim);
    if let Some(o) = owner {
        valid_name("owner", o)?;
    }
    if let Some(g) = group {
        valid_name("group", g)?;
    }
    Ok(match (owner, group) {
        (None, None) => None,
        (Some(o), None) => Some(o.to_string()),
        (o, Some(g)) => Some(format!("{}:{g}", o.unwrap_or(""))),
    })
}

/// `$1` mode, `$2` owner (either may be empty), `$3` "", a, f or d; the paths follow.
// chown clears setuid/setgid, so chmod runs after it.
pub const APPLY_SCRIPT: &str = r#"m=$1; o=$2; r=$3; shift 3
each() {
  case $r in
    f|d) find "$@" -type "$r" -exec "$cmd" "$arg" {} + ;;
    a) "$cmd" -R -- "$arg" "$@" ;;
    *) "$cmd" -- "$arg" "$@" ;;
  esac
}
if [ -n "$o" ]; then cmd=chown; arg=$o; each "$@" || exit; fi
if [ -n "$m" ]; then cmd=chmod; arg=$m; each "$@" || exit; fi
"#;

/// `uid:gid:user:group` per path, GNU/busybox `stat` first, then BSD's.
pub const OWNERS_SCRIPT: &str = r#"for p; do stat -c '%u:%g:%U:%G' -- "$p" 2>/dev/null || stat -f '%u:%g:%Su:%Sg' -- "$p" || exit; done"#;

pub fn apply_args(change: &AttrChange) -> Result<Vec<String>, String> {
    let mode = if change.changes_mode() {
        symbolic_mode(change.set, change.clear)
    } else {
        String::new()
    };
    let owner = chown_spec(change.owner.as_deref(), change.group.as_deref())?.unwrap_or_default();
    let recurse = match change.recurse {
        None => "",
        Some(Recurse::All) => "a",
        Some(Recurse::Files) => "f",
        Some(Recurse::Dirs) => "d",
    };
    let mut args = vec![mode, owner, recurse.to_string()];
    args.extend(change.paths.iter().cloned());
    Ok(args)
}

pub fn parse_owners(out: &str, count: usize) -> Option<Vec<OwnerInfo>> {
    let owners: Option<Vec<OwnerInfo>> = out
        .lines()
        .map(|line| {
            let mut f = line.trim().splitn(4, ':');
            Some(OwnerInfo {
                uid: f.next()?.parse().ok()?,
                gid: f.next()?.parse().ok()?,
                user: f.next()?.to_string(),
                group: f.next()?.to_string(),
            })
        })
        .collect();
    owners.filter(|o| o.len() == count)
}

fn as_strs(v: &[String]) -> Vec<&str> {
    v.iter().map(String::as_str).collect()
}

/// Apply `change` with `chown`/`chmod` on the files' host.
pub async fn apply_via_shell<E, B>(backend: &B, change: &AttrChange) -> Result<(), AppError>
where
    E: TransferEvents,
    B: FileBackend<E> + ?Sized,
{
    let args = apply_args(change)?;
    let out = backend.run_sh(APPLY_SCRIPT, &as_strs(&args)).await?;
    Ok(exit_error(
        "Changing permissions failed",
        out.code,
        &out.stderr,
    )?)
}

/// Each path's owner and group, or None when the host can't tell (no POSIX shell).
pub async fn owners<E, B>(backend: &B, paths: &[String]) -> Option<Vec<OwnerInfo>>
where
    E: TransferEvents,
    B: FileBackend<E> + ?Sized,
{
    let out = backend.run_sh(OWNERS_SCRIPT, &as_strs(paths)).await.ok()?;
    if out.code != Some(0) {
        return None;
    }
    parse_owners(&out.stdout_text(), paths.len())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};
    use std::path::Path;

    #[test]
    fn apply_mode_touches_only_the_named_bits() {
        assert_eq!(apply_mode(0o100644, 0o111, 0o004), 0o751);
        assert_eq!(apply_mode(0o2775, 0, 0o2000), 0o775);
        assert_eq!(apply_mode(0o644, 0o4000, 0), 0o4644);
    }

    #[test]
    fn symbolic_mode_names_every_class() {
        assert_eq!(symbolic_mode(0o755, 0o022), "u+rwx,g+rx,g-w,o+rx,o-w");
        assert_eq!(symbolic_mode(0o4000, 0o2000), "u+s,g-s");
        assert_eq!(symbolic_mode(0o1000, 0), "+t");
        assert_eq!(symbolic_mode(0, 0o1007), "o-rwx,-t");
        assert_eq!(symbolic_mode(0, 0), "");
    }

    #[test]
    fn chown_spec_covers_owner_group_and_both() {
        assert_eq!(chown_spec(None, None), Ok(None));
        assert_eq!(chown_spec(Some("www"), None), Ok(Some("www".into())));
        assert_eq!(chown_spec(None, Some("staff")), Ok(Some(":staff".into())));
        assert_eq!(
            chown_spec(Some(" root "), Some("0")),
            Ok(Some("root:0".into()))
        );
    }

    #[test]
    fn chown_spec_rejects_names_chown_would_misread() {
        for bad in ["", "-R", "a:b", "two words", "a\tb"] {
            assert!(chown_spec(Some(bad), None).is_err(), "{bad:?}");
            assert!(chown_spec(None, Some(bad)).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn only_owners_and_trees_need_a_shell() {
        let mode_only = AttrChange {
            paths: vec!["/a".into()],
            set: 0o100,
            ..Default::default()
        };
        assert!(!mode_only.needs_shell());
        assert!(AttrChange {
            group: Some("g".into()),
            ..mode_only.clone()
        }
        .needs_shell());
        assert!(AttrChange {
            recurse: Some(Recurse::All),
            ..mode_only
        }
        .needs_shell());
    }

    #[test]
    fn parse_owners_wants_one_line_per_path() {
        let out = "1000:100:voltius:users\n0:0:root:root\n";
        assert_eq!(
            parse_owners(out, 2),
            Some(vec![
                OwnerInfo {
                    uid: 1000,
                    gid: 100,
                    user: "voltius".into(),
                    group: "users".into()
                },
                OwnerInfo {
                    uid: 0,
                    gid: 0,
                    user: "root".into(),
                    group: "root".into()
                },
            ])
        );
        assert_eq!(parse_owners(out, 3), None);
        assert_eq!(parse_owners("garbage\n", 1), None);
    }

    fn mode(p: &Path) -> u32 {
        std::fs::symlink_metadata(p).unwrap().permissions().mode() & MODE_BITS
    }

    fn run(script: &str, args: &[String]) -> std::process::Output {
        std::process::Command::new("sh")
            .arg("-c")
            .arg(script)
            .arg("x")
            .args(args)
            .output()
            .unwrap()
    }

    fn tree() -> (
        tempfile::TempDir,
        std::path::PathBuf,
        std::path::PathBuf,
        std::path::PathBuf,
    ) {
        let tmp = tempfile::tempdir().unwrap();
        let top = tmp.path().join("top");
        let sub = top.join("sub");
        let file = sub.join("f.sh");
        std::fs::create_dir_all(&sub).unwrap();
        std::fs::write(&file, "x").unwrap();
        for (p, m) in [(&top, 0o700), (&sub, 0o700), (&file, 0o600)] {
            std::fs::set_permissions(p, std::fs::Permissions::from_mode(m)).unwrap();
        }
        (tmp, top, sub, file)
    }

    fn change(top: &Path, set: u32, clear: u32, recurse: Option<Recurse>) -> AttrChange {
        AttrChange {
            paths: vec![top.to_string_lossy().into_owned()],
            set,
            clear,
            recurse,
            ..Default::default()
        }
    }

    #[test]
    fn apply_script_changes_only_the_selection_without_recurse() {
        let (_tmp, top, sub, file) = tree();
        let out = run(
            APPLY_SCRIPT,
            &apply_args(&change(&top, 0o055, 0, None)).unwrap(),
        );
        assert!(out.status.success(), "{out:?}");
        assert_eq!((mode(&top), mode(&sub), mode(&file)), (0o755, 0o700, 0o600));
    }

    #[test]
    fn apply_script_recurses_into_files_or_folders_only() {
        let (_tmp, top, sub, file) = tree();
        let out = run(
            APPLY_SCRIPT,
            &apply_args(&change(&top, 0o044, 0, Some(Recurse::Files))).unwrap(),
        );
        assert!(out.status.success(), "{out:?}");
        assert_eq!((mode(&top), mode(&sub), mode(&file)), (0o700, 0o700, 0o644));

        let out = run(
            APPLY_SCRIPT,
            &apply_args(&change(&top, 0o055, 0, Some(Recurse::Dirs))).unwrap(),
        );
        assert!(out.status.success(), "{out:?}");
        assert_eq!((mode(&top), mode(&sub), mode(&file)), (0o755, 0o755, 0o644));

        let out = run(
            APPLY_SCRIPT,
            &apply_args(&change(&top, 0, 0o077, Some(Recurse::All))).unwrap(),
        );
        assert!(out.status.success(), "{out:?}");
        assert_eq!((mode(&top), mode(&sub), mode(&file)), (0o700, 0o700, 0o600));
    }

    #[test]
    fn apply_script_chowns_to_a_numeric_id_and_reports_failures() {
        let (_tmp, top, _sub, file) = tree();
        let uid = {
            let m = std::fs::metadata(&top).unwrap();
            (m.uid(), m.gid())
        };
        let mut c = change(&file, 0, 0, None);
        c.owner = Some(uid.0.to_string());
        c.group = Some(uid.1.to_string());
        let out = run(APPLY_SCRIPT, &apply_args(&c).unwrap());
        assert!(out.status.success(), "{out:?}");

        let missing = change(&top.join("nope"), 0o100, 0, None);
        let out = run(APPLY_SCRIPT, &apply_args(&missing).unwrap());
        assert!(!out.status.success());
        assert!(!out.stderr.is_empty());
    }

    #[test]
    fn owners_script_prints_one_owner_line_per_path() {
        let (_tmp, top, _sub, file) = tree();
        let paths = [top, file].map(|p| p.to_string_lossy().into_owned());
        let out = run(OWNERS_SCRIPT, &paths);
        assert!(out.status.success(), "{out:?}");
        let owners = parse_owners(&String::from_utf8_lossy(&out.stdout), 2).unwrap();
        let (uid, gid) = {
            let m = std::fs::metadata(&paths[0]).unwrap();
            (m.uid(), m.gid())
        };
        assert_eq!((owners[0].uid, owners[0].gid), (uid, gid));
    }
}
