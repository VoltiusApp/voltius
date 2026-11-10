use super::output::testing::{capture_split, captured};
use super::output::Output;
use super::session::{keychain_reachable, Device, MemKeys};
use super::{CliError, Ctx};
use std::cell::Cell;
use std::collections::BTreeMap;
use std::path::PathBuf;

pub(crate) fn ctx(out: &mut Output, yes: bool) -> Ctx<'_> {
    Ctx {
        out,
        yes,
        interactive: false,
    }
}

pub(crate) struct Outcome {
    pub result: Result<(), CliError>,
    pub out: String,
    pub err: String,
}

impl Outcome {
    pub(crate) fn capture(
        json: bool,
        yes: bool,
        command: impl FnOnce(&mut Ctx) -> Result<(), CliError>,
    ) -> Self {
        let (mut output, out, err) = capture_split(json, false);
        let result = command(&mut ctx(&mut output, yes));
        Outcome {
            result,
            out: captured(&out),
            err: captured(&err),
        }
    }

    pub(crate) fn refused(&self, code: u8, message: &str) {
        let e = self.result.as_ref().unwrap_err();
        assert_eq!((e.exit_code(), e.to_string().as_str()), (code, message));
    }
}

pub(crate) struct Machine {
    pub keys: MemKeys,
    pub running: bool,
    pub app_starts_at_check: Option<usize>,
    pub system: bool,
    pub keychain: bool,
    pub yes: bool,
    pub json: bool,
    pub dir: tempfile::TempDir,
}

impl Machine {
    pub(crate) fn new(keys: MemKeys) -> Self {
        let dir = tempfile::tempdir().unwrap();
        for sub in ["data", "config"] {
            std::fs::create_dir_all(dir.path().join(sub)).unwrap();
        }
        Machine {
            keys,
            running: false,
            app_starts_at_check: None,
            system: false,
            keychain: true,
            yes: false,
            json: false,
            dir,
        }
    }

    pub(crate) fn path(&self, sub: &str) -> PathBuf {
        self.dir.path().join(sub)
    }

    pub(crate) fn touch(&self, sub: &str) -> PathBuf {
        let path = self.path(sub);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "old").unwrap();
        path
    }

    pub(crate) fn stored(&self) -> BTreeMap<String, String> {
        self.keys.map.borrow().clone()
    }

    pub(crate) fn run(
        &self,
        command: impl FnOnce(&mut Ctx, Device) -> Result<(), CliError>,
    ) -> Outcome {
        let open = || keychain_reachable(self.keychain);
        let checks = Cell::new(0);
        let running = || {
            checks.set(checks.get() + 1);
            self.running || self.app_starts_at_check.is_some_and(|n| checks.get() >= n)
        };
        let device = Device {
            system: self.system,
            open_keychain: &open,
            keys: &self.keys,
            app_running: &running,
            data_dir: self.path("data"),
            config_dir: self.path("config"),
        };
        Outcome::capture(self.json, self.yes, |ctx| command(ctx, device))
    }
}
