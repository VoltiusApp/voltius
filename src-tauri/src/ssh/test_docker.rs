use std::io::Write;
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Mutex;

pub fn docker(args: &[&str]) -> Output {
    Command::new("docker")
        .args(args)
        .output()
        .expect("docker runs")
}

pub const TMUX_IMAGES: &[(&str, &str)] = &[
    ("tmuxh:ubuntu-22-04", "ubuntu:22.04"),
    ("tmuxh:debian-bookworm", "debian:bookworm"),
    ("tmuxh:ubuntu-24-04", "ubuntu:24.04"),
    ("tmuxh:debian-trixie-slim", "debian:trixie-slim"),
    ("tmuxh:ubuntu-26-04", "ubuntu:26.04"),
];

pub fn ensure_image(tag: &str, base: &str) {
    static BUILD: Mutex<()> = Mutex::new(());
    let _one_at_a_time = BUILD.lock().unwrap_or_else(|e| e.into_inner());
    if docker(&["image", "inspect", tag]).status.success() {
        return;
    }
    let install = if base.starts_with("rockylinux") {
        "dnf -y -q install tmux procps-ng >/dev/null && dnf clean all"
    } else {
        "apt-get -qq update && DEBIAN_FRONTEND=noninteractive apt-get -qq install -y tmux procps >/dev/null && rm -rf /var/lib/apt/lists/*"
    };
    let dockerfile = format!("FROM {base}\nRUN {install}\n");
    let mut child = Command::new("docker")
        .args(["build", "-q", "-t", tag, "-"])
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
