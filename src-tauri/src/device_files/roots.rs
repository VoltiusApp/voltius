use std::path::{Path, PathBuf};

#[derive(Debug, PartialEq)]
pub enum Jail {
    NotFound,
    Outside,
}

#[derive(Debug, PartialEq)]
pub enum Resolved {
    VirtualRoot,
    Root(usize),
    Inside { root: usize, path: PathBuf },
}

struct Root {
    name: String,
    path: PathBuf,
}

pub struct SharedRoots {
    roots: Vec<Root>,
}

fn base_name(path: &Path) -> String {
    path.file_name()
        .unwrap_or(path.as_os_str())
        .to_string_lossy()
        .into_owned()
}

pub(super) fn normalize(vpath: &str) -> Vec<&str> {
    let mut out: Vec<&str> = Vec::new();
    for seg in vpath.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                out.pop();
            }
            s => out.push(s),
        }
    }
    out
}

fn is_host_specific(seg: &str) -> bool {
    seg.contains('\0')
        || (cfg!(windows) && (seg.contains(':') || seg.contains('\\')))
        || seg.contains(std::path::MAIN_SEPARATOR)
}

fn confine(canon_root: &Path, p: &Path, missing: Jail) -> Result<PathBuf, Jail> {
    let real = p.canonicalize().map_err(|_| missing)?;
    if real.starts_with(canon_root) {
        Ok(real)
    } else {
        Err(Jail::Outside)
    }
}

fn under(canon: &Path, comps: &[&str]) -> Result<PathBuf, Jail> {
    confine(
        canon,
        &canon.join(comps.iter().collect::<PathBuf>()),
        Jail::NotFound,
    )
}

fn unfollowed(canon: &Path, comps: &[&str]) -> Result<PathBuf, Jail> {
    let (leaf, parent) = comps.split_last().expect("non-empty components");
    Ok(under(canon, parent)?.join(leaf))
}

impl SharedRoots {
    pub fn new(folders: &[PathBuf]) -> Self {
        let mut roots: Vec<Root> = Vec::with_capacity(folders.len());
        for path in folders {
            let base = base_name(path);
            let mut name = base.clone();
            let mut n = 2;
            while roots.iter().any(|r| r.name == name) {
                name = format!("{base} ({n})");
                n += 1;
            }
            roots.push(Root {
                name,
                path: path.clone(),
            });
        }
        Self { roots }
    }

    pub fn names(&self) -> Vec<String> {
        self.roots.iter().map(|r| r.name.clone()).collect()
    }

    pub fn root_dir(&self, idx: usize) -> Result<PathBuf, Jail> {
        let root = self.roots.get(idx).ok_or(Jail::NotFound)?;
        root.path.canonicalize().map_err(|_| Jail::NotFound)
    }

    fn walk(
        &self,
        vpath: &str,
        inside: impl FnOnce(&Path, &[&str]) -> Result<PathBuf, Jail>,
    ) -> Result<Resolved, Jail> {
        let comps = normalize(vpath);
        let Some((first, rest)) = comps.split_first() else {
            return Ok(Resolved::VirtualRoot);
        };
        if comps.iter().any(|c| is_host_specific(c)) {
            return Err(Jail::Outside);
        }
        let root = self
            .roots
            .iter()
            .position(|r| r.name == *first)
            .ok_or(Jail::NotFound)?;
        let canon = self.root_dir(root)?;
        if rest.is_empty() {
            return Ok(Resolved::Root(root));
        }
        let path = inside(&canon, rest)?;
        Ok(Resolved::Inside { root, path })
    }

    pub fn resolve(&self, vpath: &str) -> Result<Resolved, Jail> {
        self.walk(vpath, under)
    }

    pub fn resolve_entry(&self, vpath: &str) -> Result<Resolved, Jail> {
        self.walk(vpath, unfollowed)
    }

    pub fn resolve_for_create(&self, vpath: &str) -> Result<Resolved, Jail> {
        self.walk(vpath, |canon, rest| {
            let path = unfollowed(canon, rest)?;
            if path.symlink_metadata().is_ok() {
                confine(canon, &path, Jail::Outside)?;
            }
            Ok(path)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use std::fs;

    struct Fixture {
        _dir: tempfile::TempDir,
        root: PathBuf,
        outside: PathBuf,
        roots: SharedRoots,
    }

    fn fixture() -> Fixture {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("share");
        let outside = dir.path().join("secret");
        fs::create_dir_all(root.join("a/b")).unwrap();
        fs::create_dir_all(root.join("caf\u{e9}")).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("pw"), "x").unwrap();
        fs::write(root.join("a/f.txt"), "x").unwrap();
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, root.join("link")).unwrap();
            std::os::unix::fs::symlink(root.join("a"), root.join("inner")).unwrap();
        }
        let roots = SharedRoots::new(std::slice::from_ref(&root));
        Fixture {
            _dir: dir,
            root: root.canonicalize().unwrap(),
            outside,
            roots,
        }
    }

    #[test]
    fn dotdot_never_leaves_root() {
        let f = fixture();
        assert_eq!(f.roots.resolve("/..").unwrap(), Resolved::VirtualRoot);
        assert_eq!(f.roots.resolve("/../../..").unwrap(), Resolved::VirtualRoot);
        assert_eq!(f.roots.resolve("/share/..").unwrap(), Resolved::VirtualRoot);
        assert_eq!(
            f.roots.resolve("/share/a/../../..").unwrap(),
            Resolved::VirtualRoot
        );
        assert_eq!(
            f.roots.resolve("/share/a/../a//./b").unwrap(),
            Resolved::Inside {
                root: 0,
                path: f.root.join("a/b")
            }
        );
        assert_eq!(f.roots.resolve("").unwrap(), Resolved::VirtualRoot);
        assert_eq!(f.roots.resolve("/share").unwrap(), Resolved::Root(0));
    }

    #[test]
    fn absolute_host_path_is_outside() {
        let f = fixture();
        let host = f.outside.to_string_lossy().into_owned();
        assert!(f.roots.resolve(&host).is_err());
        assert!(f.roots.resolve(&format!("/share{host}")).is_err());
        assert_eq!(f.roots.resolve("/nope"), Err(Jail::NotFound));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_out_of_root_is_outside() {
        let f = fixture();
        assert_eq!(f.roots.resolve("/share/link"), Err(Jail::Outside));
        assert_eq!(f.roots.resolve("/share/link/pw"), Err(Jail::Outside));
        assert_eq!(
            f.roots.resolve_for_create("/share/link/new"),
            Err(Jail::Outside)
        );
    }

    #[cfg(unix)]
    #[test]
    fn create_through_leaf_symlink_out_of_root_is_outside() {
        let f = fixture();
        assert_eq!(
            f.roots.resolve_for_create("/share/link"),
            Err(Jail::Outside)
        );
    }

    #[cfg(unix)]
    #[test]
    fn symlink_inside_root_is_followed() {
        let f = fixture();
        assert_eq!(
            f.roots.resolve("/share/inner/f.txt").unwrap(),
            Resolved::Inside {
                root: 0,
                path: f.root.join("a/f.txt")
            }
        );
    }

    #[cfg(unix)]
    #[test]
    fn entry_keeps_the_leaf_symlink_unfollowed() {
        let f = fixture();
        assert_eq!(
            f.roots.resolve_entry("/share/link").unwrap(),
            Resolved::Inside {
                root: 0,
                path: f.root.join("link")
            }
        );
        assert_eq!(
            f.roots.resolve_entry("/share/inner/f.txt").unwrap(),
            Resolved::Inside {
                root: 0,
                path: f.root.join("a/f.txt")
            }
        );
        assert_eq!(f.roots.resolve_entry("/share/link/pw"), Err(Jail::Outside));
        assert_eq!(f.roots.resolve_entry("/share"), Ok(Resolved::Root(0)));
        assert_eq!(f.roots.resolve_entry("/"), Ok(Resolved::VirtualRoot));
    }

    #[test]
    fn duplicate_names_get_suffix() {
        let dir = tempfile::tempdir().unwrap();
        let folders: Vec<PathBuf> = ["x", "y", "z"]
            .iter()
            .map(|d| {
                let p = dir.path().join(d).join("docs");
                fs::create_dir_all(&p).unwrap();
                p
            })
            .collect();
        let roots = SharedRoots::new(&folders);
        assert_eq!(roots.names(), vec!["docs", "docs (2)", "docs (3)"]);
        assert_eq!(roots.resolve("/docs (3)").unwrap(), Resolved::Root(2));
    }

    #[test]
    fn missing_root_lists_but_errors_on_open() {
        let dir = tempfile::tempdir().unwrap();
        let gone = dir.path().join("gone");
        let roots = SharedRoots::new(&[gone]);
        assert_eq!(roots.names(), vec!["gone"]);
        assert_eq!(roots.resolve("/gone"), Err(Jail::NotFound));
        assert_eq!(roots.resolve("/gone/x"), Err(Jail::NotFound));
        assert_eq!(roots.resolve_for_create("/gone/x"), Err(Jail::NotFound));
    }

    #[test]
    fn create_rejects_separator_in_leaf() {
        let f = fixture();
        assert_eq!(f.roots.resolve_for_create("/share"), Ok(Resolved::Root(0)));
        assert_eq!(
            f.roots.resolve_for_create("/share/.."),
            Ok(Resolved::VirtualRoot)
        );
        assert_eq!(
            f.roots.resolve_for_create("/share/a/new.txt").unwrap(),
            Resolved::Inside {
                root: 0,
                path: f.root.join("a/new.txt")
            }
        );
        assert_eq!(
            f.roots.resolve_for_create("/share/missing/new.txt"),
            Err(Jail::NotFound)
        );
        assert_eq!(
            f.roots
                .resolve_for_create(&format!("/share/a/x{}y", std::path::MAIN_SEPARATOR)),
            if std::path::MAIN_SEPARATOR == '/' {
                Err(Jail::NotFound)
            } else {
                Err(Jail::Outside)
            }
        );
    }

    #[cfg(windows)]
    #[test]
    fn drive_and_unc_leaf_are_outside() {
        let f = fixture();
        for leaf in ["C:", "C:evil", "\\\\host\\share", "a\\b", "x:y"] {
            assert_eq!(
                f.roots.resolve_for_create(&format!("/share/a/{leaf}")),
                Err(Jail::Outside)
            );
            assert_eq!(
                f.roots.resolve(&format!("/share/a/{leaf}")),
                Err(Jail::Outside)
            );
        }
    }

    proptest! {
        #[test]
        fn no_generated_path_escapes(
            first in proptest::sample::select(vec![
                "share", "SHARE", "Share", "..", "link", "nope", "", ".",
            ]),
            segs in proptest::collection::vec(
                proptest::sample::select(vec![
                    "..", ".", "a", "b", "A", "B", "Link", "link", "inner", "", "%2e%2e",
                    "\u{2025}", "caf\u{e9}", "cafe\u{301}", "CAF\u{c9}",
                ]),
                0..8,
            )
        ) {
            let f = fixture();
            let vpath = format!("/{first}/{}", segs.join("/"));
            if let Ok(Resolved::Inside { path, .. }) = f.roots.resolve_entry(&vpath) {
                let parent = path.parent().and_then(|p| p.canonicalize().ok());
                prop_assert!(
                    parent.is_some_and(|p| p.starts_with(&f.root)),
                    "{path:?} parent escaped for {vpath:?}"
                );
            }
            for r in [f.roots.resolve(&vpath), f.roots.resolve_for_create(&vpath)] {
                if let Ok(Resolved::Inside { path, .. }) = r {
                    let real = match path.canonicalize() {
                        Ok(p) => p,
                        Err(_) => match path.parent().map(|p| p.canonicalize()) {
                            Some(Ok(p)) => p,
                            _ => return Err(TestCaseError::fail(format!("unresolvable {path:?}"))),
                        },
                    };
                    prop_assert!(real.starts_with(&f.root), "{real:?} escaped for {vpath:?}");
                }
            }
        }
    }
}
