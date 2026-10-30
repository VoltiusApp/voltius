use std::io::Write;
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub fn docker(args: &[&str]) -> Output {
    Command::new("docker")
        .args(args)
        .output()
        .expect("docker runs")
}

pub const TMUX_BASES: &[&str] = &[
    "ubuntu:22.04",
    "debian:bookworm",
    "ubuntu:24.04",
    "debian:trixie-slim",
    "ubuntu:26.04",
];

/// Builds `base` with tmux and procps once; the tag hashes the Dockerfile, so a
/// cached image always matches the current install line.
pub fn ensure_image(base: &str) -> String {
    static BUILD: Mutex<()> = Mutex::new(());
    let install = if base.starts_with("rockylinux") {
        "dnf -y -q install tmux procps-ng >/dev/null && dnf clean all"
    } else {
        "apt-get -qq update && DEBIAN_FRONTEND=noninteractive apt-get -qq install -y tmux procps >/dev/null && rm -rf /var/lib/apt/lists/*"
    };
    let dockerfile = format!("FROM {base}\nRUN {install}\n");
    let fnv = dockerfile.bytes().fold(0xcbf2_9ce4_8422_2325u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3)
    });
    let tag = format!(
        "voltius-tmux:{}-{:08x}",
        base.replace([':', '.'], "-"),
        fnv as u32
    );
    let _one_at_a_time = BUILD.lock().unwrap_or_else(|e| e.into_inner());
    if docker(&["image", "inspect", &tag]).status.success() {
        return tag;
    }
    let mut child = Command::new("docker")
        .args(["build", "-q", "-t", &tag, "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(dockerfile.as_bytes())
        .unwrap();
    assert!(child.wait().unwrap().success(), "build {tag}");
    tag
}

pub fn wait_for<T>(what: &str, timeout: Duration, mut probe: impl FnMut() -> Option<T>) -> T {
    let deadline = Instant::now() + timeout;
    loop {
        if let Some(v) = probe() {
            return v;
        }
        assert!(Instant::now() < deadline, "{what}");
        std::thread::sleep(Duration::from_millis(100));
    }
}

pub fn container_name(prefix: &str, image: &str) -> String {
    static N: AtomicUsize = AtomicUsize::new(0);
    format!(
        "{prefix}-{}-{}-{}",
        std::process::id(),
        N.fetch_add(1, Ordering::Relaxed),
        image.replace([':', '.'], "-")
    )
}

/// A container this test started; removed by its exact name when dropped.
pub struct Container(pub String);

impl Container {
    pub fn run(name: String, args: &[&str]) -> Self {
        docker(&["rm", "-f", &name]);
        let mut run = vec!["run", "-d", "--name", &name];
        run.extend_from_slice(args);
        let out = docker(&run);
        assert!(
            out.status.success(),
            "docker run {name}: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        Self(name)
    }
}

impl Drop for Container {
    fn drop(&mut self) {
        docker(&["rm", "-f", &self.0]);
    }
}
