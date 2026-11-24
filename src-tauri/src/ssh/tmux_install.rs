use crate::shell_integration::{encode_wrapper, TMUX_COPY_SOCKET, TMUX_HELPERS};
use crate::ssh::exec::{exit_error, run_cancellable, run_captured, sh_c, shell_quote, Pipe};
use crate::tmux_pin::{asset_for, TmuxAsset};
use russh::client::{Handle, Handler};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

pub const INSIDE: &str = "inside";
pub const UNSUPPORTED: &str = "unsupported";
pub const DOWNLOAD_FAILED: &str = "download";
pub const CHECKSUM_MISMATCH: &str = "checksum";
pub const NO_SHA256: &str = "no-sha256";
pub const BAD_VERSION: &str = "version";
pub const CANCELLED: &str = "cancelled";

const BIN_DIR: &str = "$HOME/.voltius/bin";
const STEP: &str = "VOLTIUS_STEP ";
const APP_DOWNLOAD: (u8, u8) = (5, 45);
const UPLOAD: (u8, u8) = (45, 80);
const FETCH_CONNECT: Duration = Duration::from_secs(15);
const FETCH_LIMIT: Duration = Duration::from_secs(300);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Step {
    Download,
    Upload,
    Verify,
    Link,
    Done,
}

impl Step {
    fn from_line(line: &str) -> Option<Self> {
        Some(match line.trim().strip_prefix(STEP)? {
            "download" => Self::Download,
            "verify" => Self::Verify,
            "link" => Self::Link,
            "done" => Self::Done,
            _ => return None,
        })
    }

    fn progress(self) -> u8 {
        match self {
            Self::Download => APP_DOWNLOAD.0,
            Self::Upload => UPLOAD.0,
            Self::Verify => 85,
            Self::Link => 95,
            Self::Done => 100,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize)]
pub struct Progress {
    pub step: Step,
    pub progress: u8,
}

pub type OnProgress<'a> = dyn Fn(Step, u8) + Sync + 'a;

#[derive(Debug, Default, PartialEq, Eq, Serialize)]
pub struct TmuxHostStatus {
    pub supported: bool,
    pub system: Option<String>,
    pub active: Option<String>,
    pub copies: Vec<TmuxCopy>,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct TmuxCopy {
    pub version: String,
    pub sessions: u32,
}

fn part_name(version: &str) -> String {
    format!(".tmux-{version}.part")
}

fn staged(version: &str) -> String {
    format!(
        r#"{TMUX_HELPERS}D={BIN_DIR}
V={v}
P=$D/{part}
mkdir -p "$D" && chmod 700 "$D/.." "$D" || exit 1
"#,
        v = shell_quote(version),
        part = shell_quote(&part_name(version)),
    )
}

fn verify_and_link(sha256: &str) -> String {
    format!(
        r#"echo {STEP}verify
if command -v sha256sum >/dev/null 2>&1; then X=$(sha256sum "$P")
elif command -v shasum >/dev/null 2>&1; then X=$(shasum -a 256 "$P")
else rm -f "$P"; exit 12
fi
[ "${{X%% *}}" = {sha} ] || {{ rm -f "$P"; exit 11; }}
chmod 755 "$P" && c "$P" && [ "${{W#tmux }}" = "$V" ] || {{ rm -f "$P"; exit 13; }}
echo {STEP}link
mv -f "$P" "$D/tmux-$V" && ln -sfn "tmux-$V" "$D/.tmux.new" && mv -f "$D/.tmux.new" "$D/tmux" || exit 1
echo {STEP}done
"#,
        sha = shell_quote(sha256),
    )
}

pub fn install_script(version: &str, url: &str, sha256: &str) -> String {
    format!(
        r#"{staged}echo {STEP}download
rm -f "$P"
{{ command -v curl >/dev/null 2>&1 && curl -fsSL -o "$P" {url}; }} ||
{{ command -v wget >/dev/null 2>&1 && wget -qO "$P" {url}; }} || {{ rm -f "$P"; exit 10; }}
{link}"#,
        staged = staged(version),
        url = shell_quote(url),
        link = verify_and_link(sha256),
    )
}

pub fn finish_script(version: &str, sha256: &str) -> String {
    format!("{}{}", staged(version), verify_and_link(sha256))
}

/// One line on purpose: it is not piped into `sh` (stdin carries the binary), so the login shell parses it.
fn upload_command(version: &str) -> String {
    sh_c(
        &format!(r#"cat > "{BIN_DIR}/$1""#),
        &[part_name(version).as_str()],
    )
}

pub fn status_script() -> String {
    format!(
        r#"{TMUX_HELPERS}D={BIN_DIR}
echo "os=$(uname -s)"
echo "arch=$(uname -m)"
echo "system=$(tmux -V 2>/dev/null)"
A=
c "$D/tmux" && A=${{W#tmux }}
echo "active=$A"
for T in "$D"/tmux-*; do
  [ -x "$T" ] || continue
  {TMUX_COPY_SOCKET}
  echo "copy=${{T##*tmux-}} sessions=$(t ls 2>/dev/null | wc -l)"
done
"#
    )
}

/// Deletes every `tmux-<ver>` but `tmux-$A` whose `-L voltius-<ver>` server is not running.
fn sweep(head: &str) -> String {
    format!(
        r#"{TMUX_HELPERS}D={BIN_DIR}
{head}
for T in "$D"/tmux-*; do
  [ -e "$T" ] && [ "$T" != "$D/tmux-$A" ] || continue
  {TMUX_COPY_SOCKET}
  if [ -x "$T" ] && t ls >/dev/null 2>&1; then echo "kept=${{T##*tmux-}}"; else rm -f "$T"; fi
done
"#
    )
}

pub fn remove_script() -> String {
    sweep("A=\nrm -f \"$D/tmux\"")
}

pub fn prune_script() -> String {
    sweep("c \"$D/tmux\" || exit 0\nA=${W#tmux }")
}

fn field<'a>(out: &'a str, key: &str) -> Option<&'a str> {
    out.lines()
        .find_map(|l| l.strip_prefix(key)?.strip_prefix('='))
        .map(str::trim)
        .filter(|v| !v.is_empty())
}

fn host_asset_in(out: &str) -> Option<&'static TmuxAsset> {
    asset_for(field(out, "os")?, field(out, "arch")?)
}

fn parse_copy(value: &str) -> Option<TmuxCopy> {
    let (version, rest) = value.split_once(' ')?;
    let sessions = rest.trim().strip_prefix("sessions=")?.trim().parse().ok()?;
    Some(TmuxCopy {
        version: version.to_string(),
        sessions,
    })
}

pub fn parse_status(out: &str) -> TmuxHostStatus {
    TmuxHostStatus {
        supported: host_asset_in(out).is_some(),
        system: field(out, "system").map(|v| v.strip_prefix("tmux ").unwrap_or(v).to_string()),
        active: field(out, "active").map(str::to_string),
        copies: out
            .lines()
            .filter_map(|l| parse_copy(l.strip_prefix("copy=")?))
            .collect(),
    }
}

pub async fn run_script<H: Handler>(handle: &Handle<H>, script: &str) -> Result<String, String> {
    let out = run_captured(handle, &encode_wrapper(script)).await?;
    exit_error("tmux script failed", out.code, &out.stderr)?;
    Ok(out.stdout_text())
}

pub async fn status<H: Handler>(handle: &Handle<H>) -> Result<TmuxHostStatus, String> {
    Ok(parse_status(&run_script(handle, &status_script()).await?))
}

/// The pinned asset for the host's OS and arch, or `UNSUPPORTED`.
pub async fn host_asset<H: Handler>(handle: &Handle<H>) -> Result<&'static TmuxAsset, String> {
    host_asset_in(&run_script(handle, &status_script()).await?).ok_or_else(|| UNSUPPORTED.into())
}

fn outcome(code: Option<i32>, stderr: &str) -> Result<(), String> {
    match code {
        Some(10) => Err(DOWNLOAD_FAILED.into()),
        Some(11) => Err(CHECKSUM_MISMATCH.into()),
        Some(12) => Err(NO_SHA256.into()),
        Some(13) => Err(BAD_VERSION.into()),
        _ => exit_error("tmux install failed", code, stderr),
    }
}

fn scaled(done: usize, total: usize, (from, to): (u8, u8)) -> u8 {
    match total {
        0 => from,
        _ => from + (usize::from(to - from) * done.min(total) / total) as u8,
    }
}

async fn run_steps<H: Handler>(
    handle: &Handle<H>,
    cmd: &str,
    stdin: &[u8],
    token: &CancellationToken,
    on_progress: &OnProgress<'_>,
) -> Result<(), String> {
    let (mut sent, mut pending, mut stderr) = (0, Vec::new(), Vec::new());
    let code = run_cancellable(
        handle,
        cmd,
        stdin,
        &mut |n| {
            sent += n;
            on_progress(Step::Upload, scaled(sent, stdin.len(), UPLOAD));
        },
        &mut |pipe, data| match pipe {
            Pipe::Stdout => {
                pending.extend_from_slice(data);
                while let Some(end) = pending.iter().position(|&b| b == b'\n') {
                    let line: Vec<u8> = pending.drain(..=end).collect();
                    if let Some(step) = Step::from_line(&String::from_utf8_lossy(&line)) {
                        on_progress(step, step.progress());
                    }
                }
            }
            Pipe::Stderr => stderr.extend_from_slice(data),
        },
        token,
    )
    .await
    .map_err(|e| {
        if token.is_cancelled() {
            CANCELLED.into()
        } else {
            e
        }
    })?;
    outcome(code, &String::from_utf8_lossy(&stderr))
}

async fn fetch(
    url: &str,
    sha256: &str,
    token: &CancellationToken,
    on_progress: &OnProgress<'_>,
) -> Result<Vec<u8>, String> {
    let client = crate::commands::http::client_builder()
        .connect_timeout(FETCH_CONNECT)
        .timeout(FETCH_LIMIT)
        .build()
        .map_err(|e| e.to_string())?;
    let download = async {
        let failed = |_| DOWNLOAD_FAILED.to_string();
        let mut response = client
            .get(url)
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(failed)?;
        let total = response.content_length().unwrap_or(0) as usize;
        let (mut body, mut shown) = (Vec::new(), APP_DOWNLOAD.0);
        while let Some(chunk) = response.chunk().await.map_err(failed)? {
            body.extend_from_slice(&chunk);
            let now = scaled(body.len(), total, APP_DOWNLOAD);
            if now != shown {
                shown = now;
                on_progress(Step::Download, now);
            }
        }
        Ok::<_, String>(body)
    };
    let body = tokio::select! {
        biased;
        _ = token.cancelled() => return Err(CANCELLED.into()),
        body = download => body?,
    };
    if format!("{:x}", Sha256::digest(&body)) != sha256 {
        return Err(CHECKSUM_MISMATCH.into());
    }
    Ok(body)
}

/// Downloads on the host; when it cannot (exit 10), the app downloads, checks and uploads the asset.
pub async fn install<H: Handler>(
    handle: &Handle<H>,
    asset: &TmuxAsset,
    version: &str,
    token: &CancellationToken,
    on_progress: &OnProgress<'_>,
) -> Result<(), String> {
    let script = install_script(version, &asset.url, &asset.sha256);
    match run_steps(handle, &encode_wrapper(&script), &[], token, on_progress).await {
        Err(e) if e == DOWNLOAD_FAILED => {}
        done => return done,
    }
    let body = fetch(&asset.url, &asset.sha256, token, on_progress).await?;
    run_steps(handle, &upload_command(version), &body, token, on_progress).await?;
    let finish = finish_script(version, &asset.sha256);
    run_steps(handle, &encode_wrapper(&finish), &[], token, on_progress).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shell_integration::MAX_EXEC_COMMAND_LEN;

    const SHA: &str = "09f1de879757523e6bfb1500b4087e6b8030fb061007ac097874f57fc43cc63c";

    fn scripts() -> Vec<String> {
        vec![
            install_script("3.8", "https://example.com/tmux-3.8-x86_64", SHA),
            finish_script("3.8", SHA),
            status_script(),
            remove_script(),
            prune_script(),
        ]
    }

    #[test]
    fn install_script_checks_sha_before_link() {
        for script in [install_script("3.8", "u", SHA), finish_script("3.8", SHA)] {
            let sha = script.find("sha256sum").unwrap();
            let check = script.find("exit 11").unwrap();
            let link = script.find("ln -sfn").unwrap();
            assert!(sha < check && check < link, "{script}");
        }
    }

    #[test]
    fn install_script_uses_curl_then_wget() {
        let script = install_script("3.8", "https://h/t?a=1&b='2'", SHA);
        let curl = script.find("curl -fsSL").unwrap();
        let wget = script.find("wget -qO").unwrap();
        assert!(curl < wget);
        assert!(script.contains(r#"'https://h/t?a=1&b='\''2'\'''"#));
        assert!(script.find("exit 10").unwrap() > wget);
    }

    #[test]
    fn parse_status_reads_copies_and_sessions() {
        let out = "os=Linux\narch=x86_64\nsystem=tmux 3.0a\nactive=3.8\n\
                   copy=3.4 sessions=2\ncopy=3.8 sessions=       0\nkept=3.4\n";
        assert_eq!(
            parse_status(out),
            TmuxHostStatus {
                supported: true,
                system: Some("3.0a".into()),
                active: Some("3.8".into()),
                copies: vec![
                    TmuxCopy {
                        version: "3.4".into(),
                        sessions: 2
                    },
                    TmuxCopy {
                        version: "3.8".into(),
                        sessions: 0
                    },
                ],
            }
        );
        let bare = parse_status("os=Linux\narch=aarch64\nsystem=\nactive=\n");
        assert_eq!(
            bare,
            TmuxHostStatus {
                supported: true,
                ..Default::default()
            }
        );
    }

    #[test]
    fn unsupported_arch_is_not_supported() {
        for out in [
            "os=Linux\narch=armv7l\n",
            "os=Darwin\narch=arm64\n",
            "os=\narch=\n",
            "",
        ] {
            assert!(!parse_status(out).supported, "{out}");
            assert!(host_asset_in(out).is_none(), "{out}");
        }
    }

    #[test]
    fn steps_map_to_progress_in_order() {
        let lines = [
            "VOLTIUS_STEP download",
            "VOLTIUS_STEP verify\r",
            "VOLTIUS_STEP link",
            "VOLTIUS_STEP done",
        ];
        let steps: Vec<_> = lines.into_iter().filter_map(Step::from_line).collect();
        assert_eq!(
            steps,
            [Step::Download, Step::Verify, Step::Link, Step::Done]
        );
        let progress: Vec<_> = steps.iter().map(|s| s.progress()).collect();
        assert!(progress.windows(2).all(|w| w[0] < w[1]) && progress[3] == 100);
        assert_eq!(Step::from_line("VOLTIUS_STEP upload"), None);
        assert_eq!(scaled(50, 100, UPLOAD), 62);
        assert_eq!(scaled(9, 0, UPLOAD), UPLOAD.0);
    }

    #[test]
    fn exit_codes_name_the_failure() {
        assert_eq!(outcome(Some(0), ""), Ok(()));
        assert_eq!(outcome(Some(10), "x"), Err(DOWNLOAD_FAILED.into()));
        assert_eq!(outcome(Some(11), ""), Err(CHECKSUM_MISMATCH.into()));
        assert_eq!(outcome(Some(12), ""), Err(NO_SHA256.into()));
        assert_eq!(outcome(Some(13), ""), Err(BAD_VERSION.into()));
        assert!(outcome(None, "").is_err());
    }

    #[test]
    fn every_script_fits_an_exec_request() {
        for script in scripts() {
            assert!(encode_wrapper(&script).len() < MAX_EXEC_COMMAND_LEN);
        }
        assert!(!upload_command("3.8").contains('\n'));
    }

    #[cfg(unix)]
    mod local {
        use super::*;
        use std::os::unix::fs::PermissionsExt;
        use std::path::{Path, PathBuf};
        use std::process::Command;

        fn scratch(tag: &str) -> PathBuf {
            let dir = std::env::temp_dir()
                .join(format!("voltius-tmux-install-{tag}-{}", std::process::id()));
            let _ = std::fs::remove_dir_all(&dir);
            std::fs::create_dir_all(dir.join("home")).unwrap();
            dir
        }

        fn write_exec(path: &Path, body: &str) {
            std::fs::write(path, body).unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }

        /// A `tmux` that reports `version` and answers `-L <sock> ls` with one session when `<sock>` is in `$LIVE`.
        fn fake_tmux(version: &str) -> String {
            format!(
                "#!/bin/sh\n[ \"$1\" = -V ] && {{ echo 'tmux {version}'; exit; }}\ncase \" $LIVE \" in *\" $2 \"*) echo 's: 1 windows';; *) exit 1;; esac\n"
            )
        }

        fn run(dir: &Path, script: &str, live: &str) -> (Option<i32>, String) {
            let out = Command::new("/bin/sh")
                .arg("-c")
                .arg(script)
                .env("HOME", dir.join("home"))
                .env("LIVE", live)
                .output()
                .expect("sh runs");
            (
                out.status.code(),
                String::from_utf8_lossy(&out.stdout).into_owned(),
            )
        }

        fn bin(dir: &Path) -> PathBuf {
            dir.join("home/.voltius/bin")
        }

        #[test]
        fn every_script_parses() {
            for script in scripts() {
                let ok = Command::new("/bin/sh")
                    .args(["-n", "-c", script.as_str()])
                    .status()
                    .unwrap();
                assert!(ok.success(), "{script}");
            }
        }

        #[test]
        fn file_url_install_verifies_links_and_reports() {
            if Command::new("curl").arg("--version").output().is_err() {
                return;
            }
            let dir = scratch("file");
            let asset = dir.join("asset");
            write_exec(&asset, &fake_tmux("3.8"));
            let sha = format!("{:x}", Sha256::digest(std::fs::read(&asset).unwrap()));
            let url = format!("file://{}", asset.display());

            let (code, out) = run(&dir, &install_script("3.8", &url, &"0".repeat(64)), "");
            assert_eq!(code, Some(11), "{out}");
            assert!(std::fs::read_dir(bin(&dir)).unwrap().next().is_none());

            let (code, out) = run(&dir, &install_script("3.9", &url, &sha), "");
            assert_eq!(code, Some(13), "{out}");
            assert!(std::fs::read_dir(bin(&dir)).unwrap().next().is_none());

            let (code, out) = run(&dir, &install_script("3.8", &url, &sha), "");
            assert_eq!(code, Some(0), "{out}");
            let steps: Vec<_> = out.lines().filter_map(Step::from_line).collect();
            assert_eq!(
                steps,
                [Step::Download, Step::Verify, Step::Link, Step::Done]
            );
            assert_eq!(
                std::fs::read_link(bin(&dir).join("tmux")).unwrap(),
                Path::new("tmux-3.8")
            );
            let (_, out) = run(&dir, &status_script(), "voltius-3.8");
            let status = parse_status(&out);
            assert_eq!(status.active.as_deref(), Some("3.8"));
            assert_eq!(
                status.copies,
                [TmuxCopy {
                    version: "3.8".into(),
                    sessions: 1
                }]
            );
            let _ = std::fs::remove_dir_all(&dir);
        }

        #[test]
        fn uploaded_copy_is_verified_and_linked() {
            let dir = scratch("upload");
            std::fs::create_dir_all(bin(&dir)).unwrap();
            let asset = fake_tmux("3.8");
            let sha = format!("{:x}", Sha256::digest(asset.as_bytes()));
            let mut upload = Command::new("/bin/sh")
                .args(["-c", upload_command("3.8").as_str()])
                .env("HOME", dir.join("home"))
                .stdin(std::process::Stdio::piped())
                .spawn()
                .unwrap();
            {
                use std::io::Write;
                upload
                    .stdin
                    .take()
                    .unwrap()
                    .write_all(asset.as_bytes())
                    .unwrap();
            }
            assert!(upload.wait().unwrap().success());

            let (code, out) = run(&dir, &finish_script("3.8", &sha), "");
            assert_eq!(code, Some(0), "{out}");
            assert_eq!(
                std::fs::read_to_string(bin(&dir).join("tmux")).unwrap(),
                asset
            );
            let _ = std::fs::remove_dir_all(&dir);
        }

        #[test]
        fn sweeps_keep_copies_with_live_servers() {
            let dir = scratch("sweep");
            std::fs::create_dir_all(bin(&dir)).unwrap();
            for v in ["3.4", "3.6", "3.8"] {
                write_exec(&bin(&dir).join(format!("tmux-{v}")), &fake_tmux(v));
            }
            std::os::unix::fs::symlink("tmux-3.8", bin(&dir).join("tmux")).unwrap();
            let present = || {
                let mut names: Vec<_> = std::fs::read_dir(bin(&dir))
                    .unwrap()
                    .map(|e| e.unwrap().file_name().into_string().unwrap())
                    .collect();
                names.sort();
                names
            };

            let (code, out) = run(&dir, &prune_script(), "voltius-3.4");
            assert_eq!((code, out.as_str()), (Some(0), "kept=3.4\n"));
            assert_eq!(present(), ["tmux", "tmux-3.4", "tmux-3.8"]);

            let (code, out) = run(&dir, &remove_script(), "voltius-3.8");
            assert_eq!((code, out.as_str()), (Some(0), "kept=3.8\n"));
            assert_eq!(present(), ["tmux-3.8"]);

            let (code, _) = run(&dir, &prune_script(), "");
            assert_eq!(code, Some(0));
            assert_eq!(present(), ["tmux-3.8"]);

            let (code, out) = run(&dir, &remove_script(), "");
            assert_eq!((code, out.as_str()), (Some(0), ""));
            assert!(present().is_empty());
            let _ = std::fs::remove_dir_all(&dir);
        }
    }

    mod docker {
        use super::*;
        use crate::ssh::test_docker::{
            container_name, docker, ensure_image_with, install_voltius_tmux, Container,
        };
        use crate::tmux_pin::pin;

        const LIST_BIN: &str = r#"ls -A "$HOME/.voltius/bin""#;

        fn host() -> Container {
            let image = ensure_image_with("debian:bookworm", "curl ca-certificates");
            let host = Container::run(
                container_name("voltius-install", &image),
                &["--init", &image, "sleep", "infinity"],
            );
            assert_ne!(sh(&host, "command -v tmux").0, Some(0));
            host
        }

        fn sh(host: &Container, script: &str) -> (Option<i32>, String) {
            let out = docker(&["exec", &host.0, "sh", "-c", script]);
            (
                out.status.code(),
                String::from_utf8_lossy(&out.stdout).into_owned(),
            )
        }

        /// The pinned asset downloaded to `/opt/tmux` and checked against the pin.
        fn fetch_pinned(host: &Container) -> &'static TmuxAsset {
            let asset = asset_for("Linux", std::env::consts::ARCH).expect("pinned asset");
            let fetch = format!(
                "curl -fsSL -o /opt/tmux {} && sha256sum /opt/tmux",
                shell_quote(&asset.url)
            );
            let (code, out) = sh(host, &fetch);
            assert_eq!(code, Some(0), "{out}");
            assert!(out.starts_with(&asset.sha256), "{out}");
            asset
        }

        fn copy(version: &str, sessions: u32) -> TmuxCopy {
            TmuxCopy {
                version: version.to_string(),
                sessions,
            }
        }

        #[test]
        #[ignore = "needs docker"]
        fn install_from_file_url_links_and_runs() {
            let host = host();
            let asset = fetch_pinned(&host);
            let version = &pin().version;
            let script = install_script(version, "file:///opt/tmux", &asset.sha256);
            let (code, out) = sh(&host, &script);
            assert_eq!(code, Some(0), "{out}");

            let status = parse_status(&sh(&host, &status_script()).1);
            assert!(status.supported);
            assert_eq!(status.system, None);
            assert_eq!(status.active.as_ref(), Some(version));
            assert_eq!(status.copies, [copy(version, 0)]);
            let (code, out) = sh(&host, r#""$HOME/.voltius/bin/tmux" -V"#);
            assert_eq!((code, out.trim()), (Some(0), &*format!("tmux {version}")));
        }

        #[test]
        #[ignore = "needs docker"]
        fn wrong_checksum_deletes_and_exits_11() {
            let host = host();
            fetch_pinned(&host);
            let script = install_script(&pin().version, "file:///opt/tmux", &"0".repeat(64));
            let (code, out) = sh(&host, &script);
            assert_eq!(code, Some(11), "{out}");
            assert_eq!(sh(&host, LIST_BIN), (Some(0), String::new()));
        }

        #[test]
        #[ignore = "needs docker"]
        fn remove_keeps_binary_with_live_server() {
            let host = host();
            let version = install_voltius_tmux(&host.0);
            let tmux = format!(r#""$HOME/.voltius/bin/tmux-{version}" -L voltius-{version}"#);
            assert_eq!(sh(&host, &format!("{tmux} new-session -d -s k")).0, Some(0));
            let status = parse_status(&sh(&host, &status_script()).1);
            assert_eq!(status.copies, [copy(&version, 1)]);

            let (code, out) = sh(&host, &remove_script());
            assert_eq!((code, out.trim()), (Some(0), &*format!("kept={version}")));
            assert_eq!(sh(&host, LIST_BIN).1.trim(), format!("tmux-{version}"));

            assert_eq!(sh(&host, &format!("{tmux} kill-server")).0, Some(0));
            assert_eq!(sh(&host, &remove_script()), (Some(0), String::new()));
            assert_eq!(sh(&host, LIST_BIN), (Some(0), String::new()));
        }
    }
}
