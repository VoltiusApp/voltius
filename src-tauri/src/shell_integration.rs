// Per-shell setup for invisible OSC 7 emission. Used by both local PTY spawn
// (via temp rcfile + custom shell args) and remote SSH (via an exec wrapper
// script that detects the user's shell at runtime).
//
// The strategy mirrors iTerm/ghostty/kitty shell integration: rather than
// echoing setup commands into a running shell (visible), we control the
// shell's *spawn* so it starts already-hooked.

use std::path::{Path, PathBuf};

/// Files/dirs to clean up when the session ends.
pub struct LocalIntegration {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
    pub tempfiles: Vec<PathBuf>,
}

/// Inspect a shell path and prepare a local PTY spawn that injects OSC 7
/// emission on every prompt. Returns `Ok(None)` for shells that need no
/// injection (fish already emits OSC 7) or can't be hooked (cmd, wsl).
pub fn prepare_local(shell: &str, session_id: &str) -> std::io::Result<Option<LocalIntegration>> {
    let shell_name = Path::new(shell)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    let temp_dir = std::env::temp_dir();

    match shell_name.as_str() {
        "bash" | "sh" => {
            let rc_path = temp_dir.join(format!("voltius-bashrc-{session_id}"));
            std::fs::write(&rc_path, BASH_RC)?;
            Ok(Some(LocalIntegration {
                program: shell.to_string(),
                args: vec![
                    "-i".into(),
                    "--rcfile".into(),
                    rc_path.to_string_lossy().into_owned(),
                ],
                env: vec![],
                tempfiles: vec![rc_path],
            }))
        }
        "zsh" => {
            let zdotdir = temp_dir.join(format!("voltius-zdotdir-{session_id}"));
            std::fs::create_dir_all(&zdotdir)?;
            std::fs::write(zdotdir.join(".zshrc"), ZSH_RC)?;
            let orig = std::env::var("ZDOTDIR")
                .or_else(|_| std::env::var("HOME"))
                .unwrap_or_default();
            Ok(Some(LocalIntegration {
                program: shell.to_string(),
                args: vec!["-i".into()],
                env: vec![
                    ("ZDOTDIR".into(), zdotdir.to_string_lossy().into_owned()),
                    ("ZDOTDIR_ORIG".into(), orig),
                ],
                tempfiles: vec![zdotdir],
            }))
        }
        "pwsh" | "powershell" => {
            let script_path = temp_dir.join(format!("voltius-pwsh-{session_id}.ps1"));
            std::fs::write(&script_path, PWSH_SCRIPT)?;
            Ok(Some(LocalIntegration {
                program: shell.to_string(),
                args: vec![
                    "-NoExit".into(),
                    "-File".into(),
                    script_path.to_string_lossy().into_owned(),
                ],
                env: vec![],
                tempfiles: vec![script_path],
            }))
        }
        "cmd" => {
            // cmd's PROMPT command supports $E (escape) and $P (cwd with
            // backslashes). We emit OSC 7 via the prompt directly — no
            // function hook needed. $E\ is ESC + backslash = ST terminator.
            let bat_path = temp_dir.join(format!("voltius-cmd-{session_id}.bat"));
            std::fs::write(&bat_path, CMD_BAT)?;
            Ok(Some(LocalIntegration {
                program: shell.to_string(),
                args: vec!["/k".into(), bat_path.to_string_lossy().into_owned()],
                env: vec![],
                tempfiles: vec![bat_path],
            }))
        }
        "wsl" => {
            // wsl.exe spawns the user's default WSL distro. The WSL wrapper
            // differs from the SSH one only in its printf format: paths are
            // emitted with host=wsl.localhost and the distro as the first
            // path segment so the frontend can build a UNC path that
            // Windows' fs API can read (`\\wsl.localhost\<distro>\path`).
            // The rcfile lives inside the WSL filesystem; no Windows-side
            // temp files.
            Ok(Some(LocalIntegration {
                program: shell.to_string(),
                args: vec![
                    "--".into(),
                    "sh".into(),
                    "-c".into(),
                    wsl_exec_command(),
                ],
                env: vec![],
                tempfiles: vec![],
            }))
        }
        // fish already emits OSC 7 on every prompt. Unknown shells fall
        // through with no integration.
        _ => Ok(None),
    }
}

/// Best-effort cleanup. Files may already be gone if user wiped /tmp.
pub fn cleanup(tempfiles: &[PathBuf]) {
    for p in tempfiles {
        if p.is_dir() {
            let _ = std::fs::remove_dir_all(p);
        } else {
            let _ = std::fs::remove_file(p);
        }
    }
}

const BASH_RC: &str = "[ -f \"$HOME/.bashrc\" ] && source \"$HOME/.bashrc\"\n\
__voltius_pwd() { printf '\\e]7;file://%s%s\\a' \"$HOSTNAME\" \"$PWD\"; }\n\
case \";${PROMPT_COMMAND-};\" in\n\
  *\";__voltius_pwd;\"*) ;;\n\
  *) PROMPT_COMMAND=\"__voltius_pwd${PROMPT_COMMAND:+;${PROMPT_COMMAND}}\" ;;\n\
esac\n\
__voltius_pwd 2>/dev/null\n";

const ZSH_RC: &str = "[ -f \"${ZDOTDIR_ORIG}/.zshrc\" ] && source \"${ZDOTDIR_ORIG}/.zshrc\"\n\
__voltius_pwd() { printf '\\e]7;file://%s%s\\a' \"${HOST}\" \"$PWD\"; }\n\
typeset -ag precmd_functions\n\
(($precmd_functions[(I)__voltius_pwd])) || precmd_functions+=(__voltius_pwd)\n\
__voltius_pwd 2>/dev/null\n";

// $E = ESC, $P = path with backslashes, $G = >, $S = space. The $E\\ sequence
// is ESC + backslash = ST (string terminator), closing the OSC 7. The path
// uses backslashes; the frontend OSC handler normalizes to forward slashes.
const CMD_BAT: &str = "@echo off\r\nprompt $E]7;file://localhost/$P$E\\$P$G$S\r\n";

const PWSH_SCRIPT: &str = "if (Test-Path $PROFILE) { . $PROFILE }\n\
$global:__voltiusOldPrompt = if (Test-Path Function:\\prompt) { $function:prompt } else { $null }\n\
function global:prompt {\n\
  $cwd = (Get-Location).Path -replace '\\\\', '/'\n\
  $hostName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'localhost' }\n\
  [Console]::Write([char]27 + ']7;file://' + $hostName + '/' + $cwd + [char]7)\n\
  if ($global:__voltiusOldPrompt) { & $global:__voltiusOldPrompt } else { \"PS $cwd> \" }\n\
}\n";

/// POSIX wrapper that detects $SHELL at runtime, writes a per-session rcfile
/// under /tmp, and execs into a hooked interactive shell. NOT invoked
/// directly — `ssh_exec_command()` wraps it in a base64 bootstrap so it's
/// safe to send regardless of the remote login shell's syntax (fish/csh
/// would otherwise choke on POSIX case/heredoc).
///
/// The `</dev/tty` on every exec is load-bearing: when run via
/// `echo b64 | base64 -d | sh`, the inner sh's stdin is the pipe from
/// base64. After exec, the new shell inherits that already-closed pipe and
/// would immediately exit on EOF (printing "exit" and looping reconnect).
/// Reopening stdin from /dev/tty restores the real PTY.
///
/// The temp file leaks intentionally — /tmp is cleared on reboot, and trying
/// to rm it from inside the rcfile races with bash/zsh reading it.
const SSH_WRAPPER: &str = r#"case "$(basename "${SHELL:-/bin/sh}")" in
zsh)
  ZDOTDIR_TMP=$(mktemp -d 2>/dev/null) || exec zsh -i </dev/tty
  export ZDOTDIR_ORIG="${ZDOTDIR:-$HOME}"
  cat > "$ZDOTDIR_TMP/.zshrc" <<'EOF'
[ -f "${ZDOTDIR_ORIG}/.zshrc" ] && source "${ZDOTDIR_ORIG}/.zshrc"
__voltius_pwd() { printf '\e]7;file://%s%s\a' "${HOST}" "$PWD"; }
typeset -ag precmd_functions
(($precmd_functions[(I)__voltius_pwd])) || precmd_functions+=(__voltius_pwd)
__voltius_pwd 2>/dev/null
EOF
  ZDOTDIR="$ZDOTDIR_TMP" exec zsh -i </dev/tty
  ;;
fish)
  exec fish -i </dev/tty
  ;;
*)
  RCFILE_TMP=$(mktemp 2>/dev/null) || exec bash -i </dev/tty
  cat > "$RCFILE_TMP" <<'EOF'
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"
__voltius_pwd() { printf '\e]7;file://%s%s\a' "$HOSTNAME" "$PWD"; }
case ";${PROMPT_COMMAND-};" in
  *";__voltius_pwd;"*) ;;
  *) PROMPT_COMMAND="__voltius_pwd${PROMPT_COMMAND:+;${PROMPT_COMMAND}}" ;;
esac
__voltius_pwd 2>/dev/null
EOF
  exec bash --rcfile "$RCFILE_TMP" -i </dev/tty
  ;;
esac
"#;

/// Build the SSH exec payload. The remote login shell (whatever it may be:
/// bash, zsh, fish, csh, dash) only needs to parse `echo ... | base64 -d |
/// sh` — a syntax common to every Unix shell. The decoded POSIX wrapper then
/// runs under /bin/sh and execs into the user's actual shell with OSC 7
/// emission hooked.
pub fn ssh_exec_command() -> String {
    encode_wrapper(SSH_WRAPPER)
}

/// Same shape as `ssh_exec_command` but encodes the WSL-flavored wrapper,
/// which emits OSC 7 with the distro name so the frontend can route the
/// panel to a `\\wsl.localhost\<distro>\` UNC path.
pub fn wsl_exec_command() -> String {
    encode_wrapper(WSL_WRAPPER)
}

fn encode_wrapper(script: &str) -> String {
    use base64::engine::general_purpose;
    use base64::Engine;
    let encoded = general_purpose::STANDARD.encode(script);
    format!("echo {encoded} | base64 -d | sh")
}

/// WSL flavor: same structure as SSH_WRAPPER but the printf format embeds
/// the distro into the OSC 7 path. The frontend recognizes the
/// `wsl.localhost` host and constructs a UNC path Windows can read.
const WSL_WRAPPER: &str = r#"WSL_DISTRO_NAME="${WSL_DISTRO_NAME:-Linux}"
export WSL_DISTRO_NAME
case "$(basename "${SHELL:-/bin/sh}")" in
zsh)
  ZDOTDIR_TMP=$(mktemp -d 2>/dev/null) || exec zsh -i </dev/tty
  export ZDOTDIR_ORIG="${ZDOTDIR:-$HOME}"
  cat > "$ZDOTDIR_TMP/.zshrc" <<'EOF'
[ -f "${ZDOTDIR_ORIG}/.zshrc" ] && source "${ZDOTDIR_ORIG}/.zshrc"
__voltius_pwd() { printf '\e]7;file://wsl.localhost/%s%s\a' "$WSL_DISTRO_NAME" "$PWD"; }
typeset -ag precmd_functions
(($precmd_functions[(I)__voltius_pwd])) || precmd_functions+=(__voltius_pwd)
__voltius_pwd 2>/dev/null
EOF
  ZDOTDIR="$ZDOTDIR_TMP" exec zsh -i </dev/tty
  ;;
fish)
  exec fish -i -C 'function __voltius_wsl_pwd --on-event fish_prompt; printf "\e]7;file://wsl.localhost/%s%s\a" "$WSL_DISTRO_NAME" "$PWD"; end' </dev/tty
  ;;
*)
  RCFILE_TMP=$(mktemp 2>/dev/null) || exec bash -i </dev/tty
  cat > "$RCFILE_TMP" <<'EOF'
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"
__voltius_pwd() { printf '\e]7;file://wsl.localhost/%s%s\a' "$WSL_DISTRO_NAME" "$PWD"; }
case ";${PROMPT_COMMAND-};" in
  *";__voltius_pwd;"*) ;;
  *) PROMPT_COMMAND="__voltius_pwd${PROMPT_COMMAND:+;${PROMPT_COMMAND}}" ;;
esac
__voltius_pwd 2>/dev/null
EOF
  exec bash --rcfile "$RCFILE_TMP" -i </dev/tty
  ;;
esac
"#;
