use crate::shell_integration::{
    persistent_attach_command, persistent_exec_command, persistent_ttl_command, ssh_exec_command,
    tmux_session_key, TTL_REAPER,
};
use crate::ssh::test_docker::{
    container_name, docker, ensure_image, wait_for, Container, TMUX_BASES,
};
use std::process::Output;
use std::time::{Duration, Instant};

const TTL: u64 = 3;
const RACE_TTL: u64 = 6;
const SETTLE: Duration = Duration::from_secs(TTL + 13);
const REAP_DEADLINE: Duration = Duration::from_secs(TTL + 40);

/// tmux < 3.2 never fires `client-detached` for a lost client, so the TTL stays unarmed there.
const PRE_3_2_BASES: &[&str] = &["rockylinux:8", "ubuntu:20.04", "debian:bullseye"];

struct Host {
    container: Container,
    image: String,
    key: String,
    first: String,
}

impl Host {
    fn start(image: String) -> Self {
        let container = Container::run(
            container_name("voltius-ttl", &image),
            &["--init", "--cpus", "0.25", &image, "sleep", "infinity"],
        );
        let mut host = Self {
            container,
            image,
            key: tmux_session_key("ttl-test"),
            first: String::new(),
        };
        host.first = host.connect(&persistent_exec_command(&host.key, &ssh_exec_command("")));
        host.wait_until("interactive shell in the pane", || {
            host.tmux(&["display", "-p", "-t", &host.key, "#{pane_current_command}"]) == "bash"
        });
        host
    }

    fn exec(&self, args: &[&str]) -> Output {
        docker(&[&["exec", self.container.0.as_str()], args].concat())
    }

    fn sh(&self, script: &str) -> Output {
        let out = self.exec(&["sh", "-c", script]);
        assert!(
            out.status.success(),
            "{}: {script}: {}",
            self.image,
            String::from_utf8_lossy(&out.stderr)
        );
        out
    }

    fn tmux_on(&self, socket: &str, args: &[&str]) -> Output {
        self.exec(&[&["tmux", "-L", socket], args].concat())
    }

    fn tmux(&self, args: &[&str]) -> String {
        let out = self.tmux_on("voltius", args);
        String::from_utf8_lossy(&out.stdout).trim().to_string()
    }

    fn type_line(&self, line: &str) {
        self.tmux(&["send-keys", "-t", &self.key, line, "Enter"]);
    }

    fn wait_for<T>(&self, what: &str, probe: impl Fn() -> Option<T>) -> T {
        wait_for(
            &format!("{}: {what}", self.image),
            Duration::from_secs(30),
            probe,
        )
    }

    fn wait_until(&self, what: &str, cond: impl Fn() -> bool) {
        self.wait_for(what, || cond().then_some(()))
    }

    fn running(&self, args: &str) -> bool {
        self.exec(&["pgrep", "-xf", args]).status.success()
    }

    fn clients(&self) -> Vec<String> {
        self.tmux(&["list-clients", "-F", "#{client_pid}"])
            .lines()
            .map(String::from)
            .collect()
    }

    fn connect(&self, cmd: &str) -> String {
        let before = self.clients();
        let env = format!("C={cmd}");
        let out = docker(&[
            "exec",
            "-d",
            "-e",
            "TERM=xterm-256color",
            "-e",
            &env,
            &self.container.0,
            "sh",
            "-c",
            r#"sleep 100000 | script -qfc "stty rows 24 cols 80; $C" /dev/null"#,
        ]);
        assert!(out.status.success(), "{}: connect", self.image);
        self.wait_for("client attached", || {
            self.clients().into_iter().find(|p| !before.contains(p))
        })
    }

    fn drop_client(&self, pid: &str) {
        self.sh(&format!("kill -9 {pid}"));
        self.wait_until("client gone", || !self.clients().iter().any(|p| p == pid));
    }

    fn arm(&self, ttl: Option<u64>) {
        self.sh(&persistent_ttl_command(&self.key, ttl));
    }

    fn present_on(&self, socket: &str) -> bool {
        self.tmux_on(socket, &["has-session", "-t", &self.key])
            .status
            .success()
    }

    fn stamp(&self) -> String {
        self.tmux(&["show", "-v", "-t", &self.key, "@voltius_detached_at"])
    }

    fn alive(&self, pid: &str) -> bool {
        self.exec(&["kill", "-0", pid]).status.success()
    }

    fn reaper_running(&self) -> bool {
        let ps = self.exec(&["ps", "-eo", "args"]);
        String::from_utf8_lossy(&ps.stdout).contains("voltius-reap")
    }

    fn settle(&self, present: bool) {
        if !present {
            let what = format!("{}: session reaped", self.image);
            wait_for(&what, REAP_DEADLINE, || {
                (!self.present_on("voltius") && !self.reaper_running()).then_some(())
            });
            return;
        }
        std::thread::sleep(SETTLE);
        assert!(
            self.present_on("voltius"),
            "{}: session present",
            self.image
        );
        assert!(
            !self.reaper_running(),
            "{}: reaper still running",
            self.image
        );
        let panes = self.tmux(&["list-panes", "-s", "-t", &self.key, "-F", "#{pane_id}"]);
        for pane in panes.lines() {
            let mode = self.tmux(&["display", "-p", "-t", pane, "#{pane_in_mode}"]);
            assert_eq!(mode, "0", "{}: reaper output shown in {pane}", self.image);
        }
    }
}

fn each_image(scenario: impl Fn(&Host) + Sync) {
    on_images(TMUX_BASES, scenario);
}

fn on_images(bases: &[&str], scenario: impl Fn(&Host) + Sync) {
    let images: Vec<String> = bases.iter().map(|base| ensure_image(base)).collect();
    let scenario = &scenario;
    let failed: Vec<&String> = std::thread::scope(|s| {
        let runs: Vec<_> = images
            .iter()
            .map(|image| {
                let run = std::thread::Builder::new()
                    .name(image.clone())
                    .spawn_scoped(s, move || scenario(&Host::start(image.clone())))
                    .unwrap();
                (image, run)
            })
            .collect();
        runs.into_iter()
            .filter_map(|(image, run)| run.join().is_err().then_some(image))
            .collect()
    });
    assert!(failed.is_empty(), "failed on {failed:?}");
}

fn after_drop(
    setup: impl Fn(&Host) + Sync,
    then: impl Fn(&Host) + Sync,
    present: bool,
    check: impl Fn(&Host) + Sync,
) {
    each_image(|h| {
        setup(h);
        h.arm(Some(TTL));
        h.drop_client(&h.first);
        then(h);
        h.settle(present);
        check(h);
    });
}

fn stamped(h: &Host) {
    h.wait_until("reaper stamped the detach", || !h.stamp().is_empty());
}

fn kept(setup: impl Fn(&Host) + Sync) {
    after_drop(setup, stamped, true, |_| {});
}

fn reaped(setup: impl Fn(&Host) + Sync) {
    after_drop(setup, stamped, false, |_| {});
}

fn typed(line: &'static str, started: &'static str) -> impl Fn(&Host) + Sync {
    move |h| {
        h.type_line(line);
        h.wait_until(started, || h.running(started));
    }
}

#[test]
#[ignore = "needs docker"]
fn dropped_client_idle_prompt_is_reaped() {
    reaped(|_| {});
}

#[test]
#[ignore = "needs docker"]
fn foreground_job_keeps_session() {
    kept(typed("sleep 1000", "sleep 1000"));
}

#[test]
#[ignore = "needs docker"]
fn background_job_keeps_session() {
    kept(typed("sleep 1000 &", "sleep 1000"));
}

#[test]
#[ignore = "needs docker"]
fn nohup_job_keeps_session() {
    kept(typed("nohup sleep 1000 >/dev/null 2>&1 &", "sleep 1000"));
}

#[test]
#[ignore = "needs docker"]
fn shell_script_keeps_session() {
    kept(|h| {
        h.sh("printf 'while :; do true; sleep 0.01; done\\n' > /tmp/s.sh");
        typed("bash /tmp/s.sh", "bash /tmp/s.sh")(h);
    });
}

#[test]
#[ignore = "needs docker"]
fn builtin_loop_at_prompt_keeps_session() {
    kept(|h| {
        h.type_line("while :; do :; done");
        std::thread::sleep(Duration::from_secs(1));
    });
}

#[test]
#[ignore = "needs docker"]
fn root_shell_at_prompt_is_reaped() {
    reaped(typed("su", "su"));
}

#[test]
#[ignore = "needs docker"]
fn one_busy_pane_among_idle_keeps_session() {
    kept(|h| {
        h.tmux(&[
            "new-window",
            "-d",
            "-t",
            &format!("{}:", h.key),
            "sleep 1000",
        ]);
        h.wait_until("second window", || h.running("sleep 1000"));
    });
}

#[test]
#[ignore = "needs docker"]
fn one_client_still_attached_keeps_session() {
    after_drop(
        |h| {
            h.connect(&persistent_attach_command(&h.key));
        },
        |_| {},
        true,
        |_| {},
    );
}

#[test]
#[ignore = "needs docker"]
fn disarm_cancels_pending_timer() {
    after_drop(
        |_| {},
        |h| {
            stamped(h);
            h.arm(None);
        },
        true,
        |_| {},
    );
}

#[test]
#[ignore = "needs docker"]
fn other_sockets_untouched() {
    after_drop(
        |h| {
            h.tmux_on(
                "other",
                &["-f", "/dev/null", "new-session", "-d", "-s", &h.key],
            );
        },
        stamped,
        false,
        |h| assert!(h.present_on("other"), "{}: -L other session", h.image),
    );
}

#[test]
#[ignore = "needs docker"]
fn reattach_and_redetach_keeps_session_until_new_ttl() {
    each_image(|h| {
        h.arm(Some(RACE_TTL));
        h.drop_client(&h.first);
        let t0 = Instant::now();
        let at = |secs: f64| {
            let due = t0 + Duration::from_secs_f64(secs);
            std::thread::sleep(due.saturating_duration_since(Instant::now()));
        };
        let first = h.wait_for("first stamp", || Some(h.stamp()).filter(|s| !s.is_empty()));
        at(4.0);
        let second_client = h.connect(&persistent_attach_command(&h.key));
        at(5.0);
        h.drop_client(&second_client);
        let second = h.wait_for("second stamp", || Some(h.stamp()).filter(|s| *s != first));
        let reaper = |stamp: &str| stamp.split_once('.').unwrap().1.to_string();
        at(8.0);
        h.wait_until("first timer exits", || !h.alive(&reaper(&first)));
        assert_eq!(h.stamp(), second, "{}: stamp after first timer", h.image);
        assert!(h.present_on("voltius"), "{}: first timer killed", h.image);
        assert!(
            h.alive(&reaper(&second)),
            "{}: second timer gone early",
            h.image
        );
        h.settle(false);
    });
}

#[test]
#[ignore = "needs docker"]
fn reaper_and_hook_reach_tmux_verbatim() {
    each_image(|h| {
        h.arm(Some(TTL));
        let reap = h
            .sh(r#"printf "$(tmux -L voltius show -gv @voltius_reap)""#)
            .stdout;
        assert!(reap == TTL_REAPER.as_bytes(), "{}: @voltius_reap", h.image);
        let hooks = h.tmux(&["show-hooks", "-t", &h.key]);
        assert!(hooks.contains("client-detached"), "{}: {hooks}", h.image);
        h.arm(None);
        let hooks = h.tmux(&["show-hooks", "-t", &h.key]);
        assert!(!hooks.contains("client-detached"), "{}: {hooks}", h.image);
    });
}

#[test]
#[ignore = "needs docker"]
fn ttl_is_not_armed_below_tmux_3_2() {
    on_images(PRE_3_2_BASES, |h| {
        h.arm(Some(TTL));
        let hooks = h.tmux(&["show-hooks", "-t", &h.key]);
        assert!(!hooks.contains("client-detached"), "{}: {hooks}", h.image);
        let ttl = h.tmux(&["show", "-v", "-t", &h.key, "@voltius_ttl"]);
        assert!(ttl.is_empty(), "{}: {ttl}", h.image);
    });
}
