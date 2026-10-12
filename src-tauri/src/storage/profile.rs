use std::ffi::OsString;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use super::secrets::SECRETS_FILE;

/// Config-dir entries that describe the machine: a switch neither moves nor deletes them.
const DEVICE_ENTRIES: &[&str] = &["mcp", "app-lock", "last-active", "updater.json"];
const CONFIG_SUBDIR: &str = "config";
const DISCARD_DIR: &str = ".discard";

pub struct ProfileDirs<'a> {
    pub secrets: &'a Path,
    pub config: &'a Path,
    pub parked: &'a Path,
}

// The server issues the id, so it is held to what is one path component on every platform.
fn profile_id(id: &str) -> Result<&str, String> {
    let ok = (1..=64).contains(&id.len())
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    ok.then_some(id)
        .ok_or_else(|| format!("Invalid account id: {id}"))
}

fn remove_path(path: &Path) -> io::Result<()> {
    if path.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

fn copy_then_remove(from: &Path, to: &Path) -> io::Result<()> {
    if let Err(e) = crate::commands::fs::copy_plain(from, to) {
        let _ = remove_path(to);
        return Err(e);
    }
    remove_path(from)
}

// Copies only when rename cannot work at all: the config and data dirs can sit on different filesystems.
fn move_path(from: &Path, to: &Path) -> io::Result<()> {
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    match fs::rename(from, to) {
        Err(e) if e.kind() == io::ErrorKind::CrossesDevices => copy_then_remove(from, to),
        result => result,
    }
}

#[derive(Default)]
struct Moves(Vec<(PathBuf, PathBuf)>);

impl Moves {
    fn run(&mut self, from: PathBuf, to: PathBuf) -> io::Result<()> {
        // Recorded first: a move that fails half-way still has to be undone.
        self.0.push((from, to));
        let (from, to) = self.0.last().expect("just pushed");
        move_path(from, to)
    }

    /// Whether everything is back where it came from.
    fn undo(self) -> bool {
        let mut complete = true;
        for (from, to) in self.0.into_iter().rev() {
            if to.symlink_metadata().is_ok() && move_path(&to, &from).is_err() {
                complete = false;
            }
        }
        complete
    }
}

fn account_entries(config: &Path) -> io::Result<Vec<OsString>> {
    let entries = match fs::read_dir(config) {
        Ok(entries) => entries,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut names = Vec::new();
    for entry in entries {
        let name = entry?.file_name();
        if !DEVICE_ENTRIES.iter().any(|device| name == *device) {
            names.push(name);
        }
    }
    Ok(names)
}

fn move_out(moves: &mut Moves, dirs: &ProfileDirs, dest: &Path) -> io::Result<()> {
    if dest.exists() {
        fs::remove_dir_all(dest)?;
    }
    if dirs.secrets.exists() {
        moves.run(dirs.secrets.to_path_buf(), dest.join(SECRETS_FILE))?;
    }
    for name in account_entries(dirs.config)? {
        moves.run(
            dirs.config.join(&name),
            dest.join(CONFIG_SUBDIR).join(&name),
        )?;
    }
    Ok(())
}

/// Whether anything was moved in: an empty or half-written park is not a restore.
fn move_in(moves: &mut Moves, dirs: &ProfileDirs, src: &Path) -> io::Result<bool> {
    if !src.is_dir() {
        return Ok(false);
    }
    let mut restored = false;
    let secrets = src.join(SECRETS_FILE);
    if secrets.exists() {
        moves.run(secrets, dirs.secrets.to_path_buf())?;
        restored = true;
    }
    let parked_config = src.join(CONFIG_SUBDIR);
    for name in account_entries(&parked_config)? {
        moves.run(parked_config.join(&name), dirs.config.join(&name))?;
        restored = true;
    }
    Ok(restored)
}

fn run_swap(
    moves: &mut Moves,
    dirs: &ProfileDirs,
    outgoing: &Path,
    incoming: Option<&Path>,
) -> io::Result<bool> {
    move_out(moves, dirs, outgoing)?;
    match incoming {
        Some(src) => move_in(moves, dirs, src),
        None => Ok(false),
    }
}

/// Move the live profile out (parked under `park_as`, or discarded) and the one
/// parked under `restore` in. Returns whether a profile was restored.
pub fn swap(
    dirs: &ProfileDirs,
    park_as: Option<&str>,
    restore: Option<&str>,
) -> Result<bool, String> {
    let park_as = park_as.map(profile_id).transpose()?;
    let restore = restore.map(profile_id).transpose()?;
    if park_as.is_some() && park_as == restore {
        return Err("Cannot switch an account into itself".to_string());
    }
    let discard = dirs.parked.join(DISCARD_DIR);
    let outgoing = park_as.map_or_else(|| discard.clone(), |id| dirs.parked.join(id));
    let incoming = restore.map(|id| dirs.parked.join(id));

    let mut moves = Moves::default();
    match run_swap(&mut moves, dirs, &outgoing, incoming.as_deref()) {
        Ok(restored) => {
            if let Some(src) = incoming {
                let _ = fs::remove_dir_all(src);
            }
            let _ = fs::remove_dir_all(&discard);
            Ok(restored)
        }
        Err(e) => {
            // A park that could not be fully undone still holds the only copy of what stayed behind.
            if moves.undo() {
                let _ = fs::remove_dir_all(&outgoing);
            }
            Err(format!("Failed to switch account data: {e}"))
        }
    }
}

pub fn drop_parked(parked: &Path, account_id: &str) -> Result<(), String> {
    match fs::remove_dir_all(parked.join(profile_id(account_id)?)) {
        Err(e) if e.kind() != io::ErrorKind::NotFound => {
            Err(format!("Failed to delete account data: {e}"))
        }
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        _tmp: tempfile::TempDir,
        secrets: PathBuf,
        config: PathBuf,
        parked: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let tmp = tempfile::tempdir().unwrap();
            let config = tmp.path().join("voltius");
            fs::create_dir(&config).unwrap();
            Self {
                secrets: tmp.path().join("secrets.enc"),
                parked: tmp.path().join("accounts"),
                config,
                _tmp: tmp,
            }
        }

        fn dirs(&self) -> ProfileDirs<'_> {
            ProfileDirs {
                secrets: &self.secrets,
                config: &self.config,
                parked: &self.parked,
            }
        }

        /// A live profile whose account files all hold `tag`, plus every device entry.
        fn live(&self, tag: &str) {
            fs::write(&self.secrets, tag).unwrap();
            fs::write(self.config.join("connections.json"), tag).unwrap();
            fs::create_dir_all(self.config.join("plugin-data")).unwrap();
            fs::write(self.config.join("plugin-data").join("docker.json"), tag).unwrap();
            fs::create_dir_all(self.config.join("mcp")).unwrap();
            fs::write(self.config.join("app-lock"), "screen").unwrap();
            fs::write(self.config.join("last-active"), "1").unwrap();
            fs::write(self.config.join("updater.json"), "{}").unwrap();
        }
    }

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap()
    }

    #[test]
    fn parking_moves_the_account_and_leaves_the_device_entries() {
        let f = Fixture::new();
        f.live("a");

        assert_eq!(swap(&f.dirs(), Some("a"), None), Ok(false));

        let parked = f.parked.join("a");
        assert_eq!(read(&parked.join("secrets.enc")), "a");
        assert_eq!(read(&parked.join("config").join("connections.json")), "a");
        assert_eq!(
            read(
                &parked
                    .join("config")
                    .join("plugin-data")
                    .join("docker.json")
            ),
            "a"
        );
        assert!(!f.secrets.exists());
        assert!(!f.config.join("connections.json").exists());
        for device in DEVICE_ENTRIES {
            assert!(f.config.join(device).exists(), "{device}");
            assert!(!parked.join("config").join(device).exists(), "{device}");
        }
    }

    #[test]
    fn a_round_trip_brings_each_account_back() {
        let f = Fixture::new();
        f.live("a");
        assert_eq!(swap(&f.dirs(), Some("a"), Some("b")), Ok(false));
        fs::write(&f.secrets, "b").unwrap();
        fs::write(f.config.join("connections.json"), "b").unwrap();

        assert_eq!(swap(&f.dirs(), Some("b"), Some("a")), Ok(true));
        assert_eq!(read(&f.secrets), "a");
        assert_eq!(read(&f.config.join("connections.json")), "a");
        assert_eq!(read(&f.config.join("plugin-data").join("docker.json")), "a");
        assert!(!f.parked.join("a").exists());

        assert_eq!(swap(&f.dirs(), Some("a"), Some("b")), Ok(true));
        assert_eq!(read(&f.secrets), "b");
        assert_eq!(read(&f.config.join("connections.json")), "b");
    }

    #[test]
    fn an_older_park_of_the_same_account_is_replaced() {
        let f = Fixture::new();
        f.live("old");
        swap(&f.dirs(), Some("a"), None).unwrap();
        f.live("new");
        swap(&f.dirs(), Some("a"), None).unwrap();

        assert_eq!(read(&f.parked.join("a").join("secrets.enc")), "new");
    }

    #[test]
    fn without_a_park_the_outgoing_profile_is_discarded() {
        let f = Fixture::new();
        f.live("a");

        assert_eq!(swap(&f.dirs(), None, None), Ok(false));

        assert!(!f.secrets.exists());
        assert!(!f.config.join("connections.json").exists());
        assert!(f.config.join("app-lock").exists());
        assert!(!f.parked.join(DISCARD_DIR).exists());
    }

    #[test]
    fn a_missing_config_dir_has_nothing_to_move() {
        let f = Fixture::new();
        fs::remove_dir(&f.config).unwrap();

        assert_eq!(swap(&f.dirs(), Some("a"), Some("b")), Ok(false));
    }

    #[test]
    fn an_empty_park_does_not_count_as_a_restore() {
        let f = Fixture::new();
        fs::create_dir_all(f.parked.join("b").join("config")).unwrap();

        assert_eq!(swap(&f.dirs(), None, Some("b")), Ok(false));
        assert!(!f.parked.join("b").exists());
    }

    #[test]
    fn a_failed_restore_puts_the_outgoing_profile_back() {
        let f = Fixture::new();
        f.live("a");
        let broken = f.parked.join("b");
        fs::create_dir_all(&broken).unwrap();
        fs::write(broken.join("config"), "not a directory").unwrap();

        assert!(swap(&f.dirs(), Some("a"), Some("b")).is_err());

        assert_eq!(read(&f.secrets), "a");
        assert_eq!(read(&f.config.join("connections.json")), "a");
        assert_eq!(read(&f.config.join("plugin-data").join("docker.json")), "a");
        assert!(!f.parked.join("a").exists());
    }

    #[test]
    fn a_parked_device_entry_never_replaces_the_live_one() {
        let f = Fixture::new();
        f.live("a");
        let parked = f.parked.join("b").join("config");
        fs::create_dir_all(&parked).unwrap();
        fs::write(parked.join("app-lock"), "vault").unwrap();
        fs::write(parked.join("connections.json"), "b").unwrap();

        assert_eq!(swap(&f.dirs(), Some("a"), Some("b")), Ok(true));

        assert_eq!(read(&f.config.join("app-lock")), "screen");
        assert_eq!(read(&f.config.join("connections.json")), "b");
    }

    #[test]
    fn an_account_cannot_be_swapped_into_itself() {
        let f = Fixture::new();
        f.live("a");

        assert!(swap(&f.dirs(), Some("a"), Some("a")).is_err());
        assert_eq!(read(&f.secrets), "a");
    }

    #[test]
    fn ids_that_are_not_a_plain_name_are_refused() {
        let f = Fixture::new();
        f.live("a");

        let too_long = "a".repeat(65);
        for id in [
            "",
            ".",
            "..",
            "a/b",
            "a\\b",
            ".discard",
            "D:x",
            "a.b",
            "con.",
            too_long.as_str(),
        ] {
            assert!(swap(&f.dirs(), Some(id), None).is_err(), "{id:?}");
            assert!(swap(&f.dirs(), None, Some(id)).is_err(), "{id:?}");
            assert!(drop_parked(&f.parked, id).is_err(), "{id:?}");
        }
        assert_eq!(read(&f.secrets), "a");
    }

    #[test]
    fn a_server_issued_uuid_is_an_acceptable_id() {
        assert!(profile_id("484ddff1-9983-4ca8-90f4-e982a079c840").is_ok());
    }

    #[test]
    fn a_rename_that_fails_for_another_reason_does_not_fall_back_to_copying() {
        let f = Fixture::new();
        f.live("a");
        let occupied = f.parked.join("occupied");
        fs::create_dir_all(occupied.join("keep")).unwrap();

        assert!(move_path(&f.config, &occupied).is_err());

        assert_eq!(read(&f.config.join("connections.json")), "a");
        assert!(!occupied.join("connections.json").exists());
    }

    #[test]
    fn an_undo_that_cannot_put_everything_back_says_so() {
        let f = Fixture::new();
        f.live("a");
        let dest = f.parked.join("a").join("secrets.enc");
        let mut moves = Moves::default();
        moves.run(f.secrets.clone(), dest.clone()).unwrap();
        fs::create_dir_all(f.secrets.join("blocker")).unwrap();

        assert!(!moves.undo());
        assert_eq!(read(&dest), "a");
    }

    #[test]
    fn dropping_removes_a_park_and_tolerates_none() {
        let f = Fixture::new();
        f.live("a");
        swap(&f.dirs(), Some("a"), None).unwrap();

        assert_eq!(drop_parked(&f.parked, "a"), Ok(()));
        assert!(!f.parked.join("a").exists());
        assert_eq!(drop_parked(&f.parked, "a"), Ok(()));
    }

    #[test]
    fn the_copy_fallback_moves_a_whole_tree() {
        let f = Fixture::new();
        f.live("a");
        let to = f.parked.join("copied");

        copy_then_remove(&f.config, &to).unwrap();

        assert_eq!(read(&to.join("plugin-data").join("docker.json")), "a");
        assert!(!f.config.exists());
    }
}
