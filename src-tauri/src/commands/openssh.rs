use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashSet};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

const MAX_INCLUDE_DEPTH: usize = 16;
const MAX_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpensshFiles {
    pub config: Option<String>,
    pub config_error: Option<String>,
    pub includes: BTreeMap<String, Vec<IncludedFile>>,
    pub keys: BTreeMap<String, KeyFiles>,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct IncludedFile {
    pub path: String,
    pub text: Option<String>,
    pub refused: bool,
}

#[derive(Serialize, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct KeyFiles {
    pub private_key: Option<String>,
    pub public_key: Option<String>,
    pub private_readable: bool,
}

#[derive(Deserialize, Debug, Default, Clone, Copy, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PrivateKeys {
    #[default]
    Read,
    Probe,
}

#[tauri::command]
pub async fn openssh_config_read(
    key_paths: Option<Vec<String>>,
    private_keys: Option<PrivateKeys>,
) -> Result<OpensshFiles, String> {
    tauri::async_runtime::spawn_blocking(move || {
        read_resolved(
            dirs::home_dir().as_deref(),
            key_paths.as_deref(),
            private_keys.unwrap_or_default(),
        )
    })
    .await
    .map_err(|e| e.to_string())
}

fn read_resolved(
    home: Option<&Path>,
    key_paths: Option<&[String]>,
    private_keys: PrivateKeys,
) -> OpensshFiles {
    match home {
        Some(home) => read_openssh(home, key_paths, private_keys),
        None => OpensshFiles {
            config_error: Some("cannot resolve home directory".into()),
            ..Default::default()
        },
    }
}

pub fn read_openssh(
    home: &Path,
    key_paths: Option<&[String]>,
    private_keys: PrivateKeys,
) -> OpensshFiles {
    let ssh_dir = home.join(".ssh");
    let path = ssh_dir.join("config");
    let mut files = OpensshFiles::default();
    match std::fs::symlink_metadata(&path) {
        Err(e) if missing(&e, &path) => return files,
        _ => match read_small(&path) {
            Some(text) => files.config = Some(text),
            None => {
                files.config_error = Some(format!("cannot read {}", path.display()));
                return files;
            }
        },
    }
    let config = files.config.clone().unwrap_or_default();
    let mut visited = HashSet::new();
    scan(
        &config,
        home,
        &ssh_dir,
        0,
        &mut visited,
        &mut files.includes,
    );
    for path in key_paths.unwrap_or_default() {
        if !files.keys.contains_key(path) {
            let key = read_key(&expand(home, path), private_keys);
            files.keys.insert(path.clone(), key);
        }
    }
    files
}

// Only key material leaves this function, so a keyPath cannot read an arbitrary file.
fn read_key(full: &Path, mode: PrivateKeys) -> KeyFiles {
    let pub_file = read_small(&PathBuf::from(format!("{}.pub", full.display())))
        .filter(|t| ssh_key::PublicKey::from_openssh(t.trim()).is_ok());
    let is_pub = full.extension().is_some_and(|e| e == "pub");
    let text = read_small(full);
    let derived = text.as_deref().and_then(public_half);
    let private = text.filter(|t| !is_pub && looks_private(t));
    KeyFiles {
        public_key: pub_file.or(derived),
        private_readable: private.is_some(),
        private_key: private.filter(|_| mode == PrivateKeys::Read),
    }
}

// Stricter than looksLikePrivateKey: the whole file must be one key, so nothing else in it leaves.
fn looks_private(text: &str) -> bool {
    let lines: Vec<&str> = text.trim().lines().map(str::trim).collect();
    fn label<'a>(line: &'a str, edge: &str) -> Option<&'a str> {
        line.strip_prefix(edge)
            .and_then(|r| r.strip_suffix("PRIVATE KEY-----"))
            .filter(|mid| {
                mid.chars()
                    .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == ' ')
            })
    }
    let body = |inner: &[&str]| {
        inner.iter().all(|l| {
            l.chars()
                .all(|c| c.is_ascii_alphanumeric() || "+/=".contains(c))
                || l.split_once(": ")
                    .is_some_and(|(k, _)| k.chars().all(|c| c.is_ascii_alphanumeric() || c == '-'))
        })
    };
    match lines.as_slice() {
        [first, inner @ .., last] if first.starts_with("-----BEGIN ") => {
            label(first, "-----BEGIN ").is_some_and(|a| label(last, "-----END ") == Some(a))
                && body(inner)
        }
        [first, ..] if first.starts_with("PuTTY-User-Key-File") => body(&lines),
        _ => false,
    }
}

// The OpenSSH format stores the public half in clear, so an encrypted key needs no passphrase.
fn public_half(text: &str) -> Option<String> {
    let text = text.trim();
    if let Ok(key) = ssh_key::PublicKey::from_openssh(text) {
        return key.to_openssh().ok();
    }
    if !looks_private(text) {
        return None;
    }
    match ssh_key::PrivateKey::from_openssh(text) {
        Ok(key) => key.public_key().to_openssh().ok(),
        Err(_) => russh::keys::decode_secret_key(text, None)
            .ok()?
            .public_key()
            .to_openssh()
            .ok(),
    }
}

fn read_small(path: &Path) -> Option<String> {
    let meta = std::fs::metadata(path).ok()?;
    if !meta.is_file() || meta.len() > MAX_FILE_BYTES {
        return None;
    }
    let mut text = String::new();
    std::fs::File::open(path)
        .ok()?
        .take(MAX_FILE_BYTES + 1)
        .read_to_string(&mut text)
        .ok()?;
    (text.len() as u64 <= MAX_FILE_BYTES).then_some(text)
}

fn scan(
    text: &str,
    home: &Path,
    ssh_dir: &Path,
    depth: usize,
    visited: &mut HashSet<PathBuf>,
    includes: &mut BTreeMap<String, Vec<IncludedFile>>,
) {
    for line in text.trim_start_matches('\u{feff}').lines() {
        let Some((key, value)) = directive(line) else {
            continue;
        };
        if key != "include" || depth >= MAX_INCLUDE_DEPTH {
            continue;
        }
        for pattern in args(&value) {
            let target = expand(home, &pattern);
            let inside = target.starts_with(ssh_dir)
                && !target.components().any(|c| c == Component::ParentDir);
            if !inside {
                includes.entry(pattern).or_insert_with(|| {
                    vec![IncludedFile {
                        path: target.display().to_string(),
                        text: None,
                        refused: true,
                    }]
                });
                continue;
            }
            let Some(paths) = glob(&target) else {
                continue;
            };
            let mut found = Vec::new();
            for path in paths {
                let text = read_small(&path);
                if let Some(t) = &text {
                    if visited.insert(path.clone()) {
                        scan(t, home, ssh_dir, depth + 1, visited, includes);
                    }
                }
                found.push(IncludedFile {
                    path: path.display().to_string(),
                    text,
                    refused: false,
                });
            }
            includes.entry(pattern).or_insert(found);
        }
    }
}

fn directive(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let split = line.find(|c: char| c.is_whitespace() || c == '=')?;
    let value = line[split..]
        .trim_start_matches(|c: char| c.is_whitespace() || c == '=')
        .trim();
    Some((line[..split].to_ascii_lowercase(), value.to_string()))
}

fn args(value: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = value.trim();
    while !rest.is_empty() {
        if let Some(stripped) = rest.strip_prefix('"') {
            let end = stripped.find('"').unwrap_or(stripped.len());
            out.push(stripped[..end].to_string());
            rest = stripped.get(end + 1..).unwrap_or("").trim_start();
        } else {
            let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            out.push(rest[..end].to_string());
            rest = rest[end..].trim_start();
        }
    }
    out
}

fn expand(home: &Path, path: &str) -> PathBuf {
    if path == "~" {
        return home.to_path_buf();
    }
    if let Some(rest) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        return home.join(rest);
    }
    let p = PathBuf::from(path);
    if p.is_absolute() {
        p
    } else {
        home.join(".ssh").join(p)
    }
}

// OpenSSH skips an Include that matches nothing; a directory it cannot list or reach is unreadable.
// Like glob(3), a wildcard never matches a leading dot.
fn glob(path: &Path) -> Option<Vec<PathBuf>> {
    let parts: Vec<_> = path.components().collect();
    let mut found = vec![PathBuf::new()];
    for (i, part) in parts.iter().enumerate() {
        let name = part.as_os_str().to_string_lossy();
        if !name.contains(['*', '?']) {
            found.iter_mut().for_each(|p| p.push(part));
            continue;
        }
        let last = i + 1 == parts.len();
        let mut next = Vec::new();
        for dir in &found {
            let entries = match std::fs::read_dir(dir) {
                Ok(entries) => entries,
                Err(e) if missing(&e, dir) => continue,
                Err(_) => return None,
            };
            next.extend(entries.flatten().map(|e| e.path()).filter(|p| {
                (if last { !p.is_dir() } else { p.is_dir() })
                    && p.file_name().is_some_and(|n| {
                        let n = n.to_string_lossy();
                        (name.starts_with('.') || !n.starts_with('.')) && wildcard(&name, &n)
                    })
            }));
        }
        next.sort();
        found = next;
    }
    let mut kept = Vec::new();
    for p in found {
        match std::fs::symlink_metadata(&p) {
            Ok(_) => kept.push(p),
            Err(e) if missing(&e, &p) => {}
            Err(_) => return None,
        }
    }
    Some(kept)
}

// Only a plain NotFound is absent; any other error, or a dangling link above, is unreadable.
fn missing(e: &std::io::Error, path: &Path) -> bool {
    e.kind() == std::io::ErrorKind::NotFound && !behind_dangling_link(path)
}

// A link to an unmounted volume hides files that still exist, so it cannot count as empty.
fn behind_dangling_link(path: &Path) -> bool {
    path.ancestors()
        .find_map(|a| std::fs::symlink_metadata(a).ok().map(|m| (a, m)))
        .is_some_and(|(a, m)| m.file_type().is_symlink() && std::fs::metadata(a).is_err())
}

fn wildcard(pattern: &str, name: &str) -> bool {
    let (p, n): (Vec<char>, Vec<char>) = (pattern.chars().collect(), name.chars().collect());
    let (mut pi, mut ni, mut star, mut mark) = (0, 0, None, 0);
    while ni < n.len() {
        if pi < p.len() && (p[pi] == '?' || p[pi] == n[ni]) {
            pi += 1;
            ni += 1;
        } else if pi < p.len() && p[pi] == '*' {
            star = Some(pi);
            mark = ni;
            pi += 1;
        } else if let Some(s) = star {
            pi = s + 1;
            mark += 1;
            ni = mark;
        } else {
            return false;
        }
    }
    p[pi..].iter().all(|&c| c == '*')
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(list: &[&str]) -> Vec<String> {
        list.iter().map(|p| p.to_string()).collect()
    }

    fn write(home: &Path, rel: &str, text: &str) {
        let p = home.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, text).unwrap();
    }

    #[test]
    fn missing_config_reads_nothing() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(
            read_openssh(home.path(), None, PrivateKeys::Read),
            OpensshFiles::default()
        );
    }

    #[test]
    fn missing_config_is_not_an_error() {
        let home = tempfile::tempdir().unwrap();
        let files = read_openssh(home.path(), None, PrivateKeys::Read);
        assert_eq!(files.config, None);
        assert_eq!(files.config_error, None);
    }

    #[test]
    fn unreadable_config_reports_an_error() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".ssh/config")).unwrap();
        let files = read_openssh(home.path(), None, PrivateKeys::Read);
        assert_eq!(files.config, None);
        assert!(files.config_error.is_some());
    }

    #[test]
    fn unresolvable_home_reports_an_error() {
        let files = read_resolved(None, None, PrivateKeys::Read);
        assert_eq!(files.config, None);
        assert!(files.config_error.is_some());
    }

    #[cfg(unix)]
    #[test]
    fn dangling_config_symlink_reports_an_error() {
        let home = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(home.path().join(".ssh")).unwrap();
        std::os::unix::fs::symlink(home.path().join("gone"), home.path().join(".ssh/config"))
            .unwrap();
        let files = read_openssh(home.path(), None, PrivateKeys::Read);
        assert_eq!(files.config, None);
        assert!(files.config_error.is_some());
    }

    #[test]
    fn reads_config_includes_sorted_and_keys() {
        let home = tempfile::tempdir().unwrap();
        write(
            home.path(),
            ".ssh/config",
            "Include conf.d/*\nHost a\n  IdentityFile ~/.ssh/id_a\n",
        );
        write(
            home.path(),
            ".ssh/conf.d/b",
            "Host b\n  IdentityFile=id_b\n",
        );
        write(home.path(), ".ssh/conf.d/a", "Host c\n");
        let (pem, public) = crate::commands::keygen::ed25519_pem(None);
        write(home.path(), ".ssh/id_a", &pem);
        write(home.path(), ".ssh/id_a.pub", &public);
        let files = read_openssh(
            home.path(),
            Some(&paths(&["~/.ssh/id_a", "~/.ssh/id_b"])),
            PrivateKeys::Read,
        );
        assert!(files.config.unwrap().starts_with("Include"));
        let inc = &files.includes["conf.d/*"];
        assert_eq!(
            inc.iter()
                .map(|f| f.text.clone().unwrap())
                .collect::<Vec<_>>(),
            vec!["Host c\n", "Host b\n  IdentityFile=id_b\n"]
        );
        assert_eq!(
            files.keys["~/.ssh/id_a"],
            KeyFiles {
                private_key: Some(pem),
                public_key: Some(public),
                private_readable: true,
            }
        );
        assert_eq!(files.keys["~/.ssh/id_b"], KeyFiles::default());
    }

    #[test]
    fn include_cycles_and_depth_terminate() {
        let home = tempfile::tempdir().unwrap();
        write(home.path(), ".ssh/config", "Include a\n");
        write(home.path(), ".ssh/a", "Include b\n");
        write(home.path(), ".ssh/b", "Include a\n");
        let files = read_openssh(home.path(), None, PrivateKeys::Read);
        assert_eq!(files.includes["a"].len(), 1);
        assert_eq!(files.includes["b"].len(), 1);
    }

    #[test]
    fn refuses_includes_outside_dot_ssh() {
        let home = tempfile::tempdir().unwrap();
        write(home.path(), ".ssh/config", "Include ../secret\n");
        write(home.path(), "secret", "Host x\n");
        let files = read_openssh(home.path(), None, PrivateKeys::Read);
        assert_eq!(files.includes["../secret"][0].text, None);
        assert!(files.includes["../secret"][0].refused);
    }

    #[test]
    fn a_missing_include_inside_dot_ssh_matches_nothing() {
        let home = tempfile::tempdir().unwrap();
        write(
            home.path(),
            ".ssh/config",
            "Include missing\nInclude gone.d/*\nInclude ~/elsewhere\n",
        );
        let files = read_openssh(home.path(), None, PrivateKeys::Read);
        assert!(files.includes["missing"].is_empty());
        assert!(files.includes["gone.d/*"].is_empty());
        assert!(files.includes["~/elsewhere"][0].refused);
    }

    #[test]
    fn an_unreadable_include_inside_dot_ssh_is_not_refused() {
        let home = tempfile::tempdir().unwrap();
        write(home.path(), ".ssh/config", "Include sub\n");
        std::fs::create_dir_all(home.path().join(".ssh/sub")).unwrap();
        let files = read_openssh(home.path(), None, PrivateKeys::Read);
        assert_eq!(files.includes["sub"][0].text, None);
        assert!(!files.includes["sub"][0].refused);
    }

    #[test]
    fn globs_a_wildcard_directory() {
        let home = tempfile::tempdir().unwrap();
        write(home.path(), ".ssh/config", "Include conf.*/hosts\n");
        write(home.path(), ".ssh/conf.a/hosts", "Host a\n");
        write(home.path(), ".ssh/conf.b/other", "Host b\n");
        write(home.path(), ".ssh/conf.c", "not a directory");
        let files = read_openssh(home.path(), None, PrivateKeys::Read);
        let inc = &files.includes["conf.*/hosts"];
        assert_eq!(inc.len(), 1);
        assert_eq!(inc[0].text.as_deref(), Some("Host a\n"));
    }

    #[test]
    fn a_glob_include_outside_dot_ssh_is_refused_even_when_its_directory_is_missing() {
        let home = tempfile::tempdir().unwrap();
        write(home.path(), ".ssh/config", "Include ~/.orbstack/ssh/*\n");
        let files = read_openssh(home.path(), None, PrivateKeys::Read);
        let inc = &files.includes["~/.orbstack/ssh/*"];
        assert_eq!(inc.len(), 1);
        assert_eq!(inc[0].text, None);
        assert!(inc[0].refused);
    }

    #[test]
    fn an_unreadable_include_directory_leaves_its_pattern_unresolved() {
        let home = tempfile::tempdir().unwrap();
        write(home.path(), ".ssh/config", "Include conf.d/*\n");
        write(home.path(), ".ssh/conf.d", "not a directory");
        let files = read_openssh(home.path(), None, PrivateKeys::Read);
        assert!(!files.includes.contains_key("conf.d/*"));
    }

    #[cfg(unix)]
    #[test]
    fn a_dangling_include_symlink_is_reported_unreadable() {
        let home = tempfile::tempdir().unwrap();
        write(home.path(), ".ssh/config", "Include conf.d/*\n");
        write(home.path(), ".ssh/conf.d/a", "Host a\n");
        std::os::unix::fs::symlink(home.path().join("gone"), home.path().join(".ssh/conf.d/b"))
            .unwrap();
        let files = read_openssh(home.path(), None, PrivateKeys::Read);
        let inc = &files.includes["conf.d/*"];
        assert_eq!(inc.len(), 2);
        assert!(inc[1].path.ends_with("conf.d/b"));
        assert_eq!(inc[1].text, None);
        assert!(!inc[1].refused);
    }

    #[cfg(unix)]
    #[test]
    fn an_include_in_a_directory_it_cannot_search_is_unresolved() {
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap();
        write(
            home.path(),
            ".ssh/config",
            "Include conf.d/work\nInclude conf.d/*\n",
        );
        write(home.path(), ".ssh/conf.d/work", "Host w\n");
        let dir = home.path().join(".ssh/conf.d");
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o000)).unwrap();
        let blocked = std::fs::symlink_metadata(dir.join("work")).is_err();
        let files = read_openssh(home.path(), None, PrivateKeys::Read);
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o755)).unwrap();
        if blocked {
            assert!(!files.includes.contains_key("conf.d/work"));
            assert!(!files.includes.contains_key("conf.d/*"));
        }
    }

    #[cfg(unix)]
    #[test]
    fn a_config_behind_a_dangling_ssh_link_reports_an_error() {
        let home = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(home.path().join("volume"), home.path().join(".ssh")).unwrap();
        let files = read_openssh(home.path(), None, PrivateKeys::Read);
        assert_eq!(files.config, None);
        assert!(files.config_error.is_some());
    }

    #[cfg(unix)]
    #[test]
    fn an_include_behind_a_dangling_directory_link_is_unresolved() {
        let home = tempfile::tempdir().unwrap();
        write(
            home.path(),
            ".ssh/config",
            "Include conf.d/*\nInclude conf.d/hosts\nInclude gone.d/*\n",
        );
        std::os::unix::fs::symlink(home.path().join("volume"), home.path().join(".ssh/conf.d"))
            .unwrap();
        let files = read_openssh(home.path(), None, PrivateKeys::Read);
        assert!(!files.includes.contains_key("conf.d/*"));
        assert!(!files.includes.contains_key("conf.d/hosts"));
        assert!(files.includes["gone.d/*"].is_empty());
    }

    #[test]
    fn only_a_file_that_is_one_whole_key_reads_as_private() {
        let (pem, _) = crate::commands::keygen::ed25519_pem(None);
        let legacy = "-----BEGIN RSA PRIVATE KEY-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00FF\n\nMIIEow==\n-----END RSA PRIVATE KEY-----\n";
        let putty =
            "PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\nPublic-Lines: 1\nAAAAC3Nz\n";
        assert!(looks_private(&pem));
        assert!(looks_private(&format!("\n{pem}\n")));
        assert!(looks_private(legacy));
        assert!(looks_private(putty));
        assert!(!looks_private(&format!(
            "#!/bin/sh\nTOKEN=secret\ncat <<EOF\n{pem}EOF\n"
        )));
        assert!(!looks_private(&format!("{pem}password=hunter2\n")));
        assert!(!looks_private(&format!("{pem}{pem}")));
        assert!(!looks_private(
            "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END DSA PRIVATE KEY-----"
        ));
    }

    #[test]
    fn probe_derives_the_public_key_and_withholds_the_private_key() {
        let home = tempfile::tempdir().unwrap();
        let (pem, public) = crate::commands::keygen::ed25519_pem(Some("hunter2"));
        write(home.path(), ".ssh/config", "Host a\n");
        write(home.path(), ".ssh/id_a", &pem);
        let key_paths = paths(&["~/.ssh/id_a"]);
        let probed =
            &read_openssh(home.path(), Some(&key_paths), PrivateKeys::Probe).keys["~/.ssh/id_a"];
        assert_eq!(probed.private_key, None);
        assert!(probed.private_readable);
        assert_eq!(probed.public_key.as_deref(), Some(public.as_str()));
        let read =
            &read_openssh(home.path(), Some(&key_paths), PrivateKeys::Read).keys["~/.ssh/id_a"];
        assert_eq!(read.private_key.as_deref(), Some(pem.as_str()));
    }

    #[test]
    fn returns_only_key_material() {
        let home = tempfile::tempdir().unwrap();
        let (pem, public) = crate::commands::keygen::ed25519_pem(None);
        write(home.path(), ".ssh/config", "Host a\n");
        write(home.path(), "notes", "aws_secret_access_key = hunter2");
        write(home.path(), "notes.pub", "not a key either");
        write(home.path(), ".ssh/id_c.pub", &public);
        write(home.path(), ".ssh/id_d", &pem);
        write(
            home.path(),
            "deploy.sh",
            &format!("TOKEN=hunter2\ncat <<K\n{pem}K\n"),
        );
        let files = read_openssh(
            home.path(),
            Some(&paths(&[
                "~/notes",
                "~/.ssh/id_c.pub",
                "~/.ssh/id_d",
                "~/deploy.sh",
            ])),
            PrivateKeys::Read,
        );
        assert_eq!(files.keys["~/notes"], KeyFiles::default());
        assert_eq!(files.keys["~/deploy.sh"], KeyFiles::default());
        let c = &files.keys["~/.ssh/id_c.pub"];
        assert_eq!(
            (c.private_key.as_deref(), c.private_readable),
            (None, false)
        );
        assert_eq!(c.public_key.as_deref(), Some(public.as_str()));
        let d = &files.keys["~/.ssh/id_d"];
        assert_eq!(d.private_key.as_deref(), Some(pem.as_str()));
        assert_eq!(d.public_key.as_deref(), Some(public.as_str()));
    }

    #[test]
    fn wildcards_skip_dotfiles() {
        let home = tempfile::tempdir().unwrap();
        write(
            home.path(),
            ".ssh/config",
            "Include conf.d/*\nInclude conf.d/.*\n",
        );
        write(home.path(), ".ssh/conf.d/a", "Host a\n");
        write(home.path(), ".ssh/conf.d/.DS_Store", "\u{0}binary");
        write(home.path(), ".ssh/conf.d/.hidden", "Host h\n");
        let files = read_openssh(home.path(), None, PrivateKeys::Read);
        let plain = &files.includes["conf.d/*"];
        assert_eq!(plain.len(), 1);
        assert!(plain[0].path.ends_with("conf.d/a"));
        assert_eq!(files.includes["conf.d/.*"].len(), 2);
    }

    #[test]
    fn reads_no_keys_without_key_paths() {
        let home = tempfile::tempdir().unwrap();
        write(
            home.path(),
            ".ssh/config",
            "Host a\n  IdentityFile ~/.ssh/id_a\n",
        );
        write(home.path(), ".ssh/id_a", "PRIVATE A");
        assert!(read_openssh(home.path(), None, PrivateKeys::Read)
            .keys
            .is_empty());
    }

    #[test]
    fn reads_only_the_listed_keys() {
        let home = tempfile::tempdir().unwrap();
        write(home.path(), ".ssh/config", "Host a\n");
        let (pem, _) = crate::commands::keygen::ed25519_pem(None);
        for name in ["id_a", "id_b"] {
            write(home.path(), &format!(".ssh/{name}"), &pem);
        }
        let files = read_openssh(
            home.path(),
            Some(&paths(&["~/.ssh/id_a"])),
            PrivateKeys::Read,
        );
        assert_eq!(
            files.keys.keys().cloned().collect::<Vec<_>>(),
            vec!["~/.ssh/id_a".to_string()]
        );
        assert_eq!(
            files.keys["~/.ssh/id_a"].private_key.as_deref(),
            Some(pem.as_str())
        );
    }

    #[test]
    fn oversize_files_are_unreadable() {
        let big = "#".repeat(MAX_FILE_BYTES as usize + 1);
        let home = tempfile::tempdir().unwrap();
        write(
            home.path(),
            ".ssh/config",
            "Include big\nIdentityFile ~/.ssh/big\n",
        );
        write(home.path(), ".ssh/big", &big);
        let files = read_openssh(
            home.path(),
            Some(&paths(&["~/.ssh/big"])),
            PrivateKeys::Read,
        );
        assert_eq!(files.includes["big"][0].text, None);
        assert_eq!(files.keys["~/.ssh/big"].private_key, None);
        write(home.path(), ".ssh/config", &big);
        assert_eq!(
            read_openssh(home.path(), None, PrivateKeys::Read).config,
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn special_files_are_unreadable() {
        let home = tempfile::tempdir().unwrap();
        let ssh = home.path().join(".ssh");
        write(
            home.path(),
            ".ssh/config",
            "Include fifo\nIdentityFile ~/.ssh/zero\n",
        );
        let made = std::process::Command::new("mkfifo")
            .arg(ssh.join("fifo"))
            .status()
            .unwrap();
        assert!(made.success());
        std::os::unix::fs::symlink("/dev/zero", ssh.join("zero")).unwrap();
        let files = read_openssh(
            home.path(),
            Some(&paths(&["~/.ssh/zero"])),
            PrivateKeys::Read,
        );
        assert_eq!(files.includes["fifo"][0].text, None);
        assert_eq!(files.keys["~/.ssh/zero"].private_key, None);
        std::fs::remove_file(ssh.join("config")).unwrap();
        std::os::unix::fs::symlink(ssh.join("fifo"), ssh.join("config")).unwrap();
        assert_eq!(
            read_openssh(home.path(), None, PrivateKeys::Read).config,
            None
        );
    }
}
