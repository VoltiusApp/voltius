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
            std::fs::write(zdotdir.join(".zshenv"), ZSH_ZSHENV)?;
            let orig = std::env::var("ZDOTDIR")
                .or_else(|_| std::env::var("HOME"))
                .unwrap_or_default();
            Ok(Some(LocalIntegration {
                program: shell.to_string(),
                args: vec!["-l".into(), "-i".into()],
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
                args: vec!["--".into(), "sh".into(), "-c".into(), wsl_exec_command()],
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

const BASH_RC: &str = "if [ -r /etc/profile ]; then . /etc/profile; fi\n\
if [ -r \"$HOME/.bash_profile\" ]; then . \"$HOME/.bash_profile\"\n\
elif [ -r \"$HOME/.bash_login\" ]; then . \"$HOME/.bash_login\"\n\
elif [ -r \"$HOME/.profile\" ]; then . \"$HOME/.profile\"\n\
else\n\
  [ -r /etc/bash.bashrc ] && . /etc/bash.bashrc\n\
  [ -r \"$HOME/.bashrc\" ] && . \"$HOME/.bashrc\"\n\
fi\n\
__voltius_pwd() { printf '\\e]7;file://%s%s\\a' \"$HOSTNAME\" \"$PWD\"; }\n\
case \";${PROMPT_COMMAND-};\" in\n\
  *\";__voltius_pwd;\"*) ;;\n\
  *) PROMPT_COMMAND=\"__voltius_pwd${PROMPT_COMMAND:+;${PROMPT_COMMAND}}\" ;;\n\
esac\n\
__voltius_pwd 2>/dev/null\n";

// .zshenv trampoline (kitty/ghostty technique): restores ZDOTDIR from
// ZDOTDIR_ORIG then sources the real .zshenv so zsh continues startup with
// the user's files. Fixes configs like zsh4humans that define functions in
// ~/.zshenv before .zshrc runs. The hook installs at .zshenv time, so rc
// files that overwrite precmd_functions (instead of appending) drop cwd
// tracking — accepted trade-off shared with kitty/ghostty.
const ZSH_ZSHENV: &str =
    "if [ -n \"${ZDOTDIR_ORIG-}\" ]; then ZDOTDIR=\"$ZDOTDIR_ORIG\"; else unset ZDOTDIR; fi\n\
unset ZDOTDIR_ORIG\n\
[ -f \"${ZDOTDIR:-$HOME}/.zshenv\" ] && source \"${ZDOTDIR:-$HOME}/.zshenv\"\n\
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
  ZDOTDIR_TMP=$(mktemp -d 2>/dev/null) || exec zsh -l -i </dev/tty
  export ZDOTDIR_ORIG="${ZDOTDIR:-$HOME}"
  cat > "$ZDOTDIR_TMP/.zshenv" <<'EOF'
if [ -n "${ZDOTDIR_ORIG-}" ]; then ZDOTDIR="$ZDOTDIR_ORIG"; else unset ZDOTDIR; fi
unset ZDOTDIR_ORIG
[ -f "${ZDOTDIR:-$HOME}/.zshenv" ] && source "${ZDOTDIR:-$HOME}/.zshenv"
__voltius_pwd() { printf '\e]7;file://%s%s\a' "${HOST}" "$PWD"; }
typeset -ag precmd_functions
(($precmd_functions[(I)__voltius_pwd])) || precmd_functions+=(__voltius_pwd)
__voltius_pwd 2>/dev/null
EOF
  ZDOTDIR="$ZDOTDIR_TMP" exec zsh -l -i </dev/tty
  ;;
fish)
  exec fish -l -i </dev/tty
  ;;
*)
  if command -v bash >/dev/null 2>&1; then
  RCFILE_TMP=$(mktemp 2>/dev/null) || exec bash -l -i </dev/tty
  cat > "$RCFILE_TMP" <<'EOF'
# Replicate bash's own startup so the session matches a normal interactive
# login: --rcfile otherwise skips /etc/profile, /etc/bash.bashrc and the
# profile chain, which is where PS1 and profile-driven welcome text live.
if [ -r /etc/profile ]; then . /etc/profile; fi
if [ -r "$HOME/.bash_profile" ]; then . "$HOME/.bash_profile"
elif [ -r "$HOME/.bash_login" ]; then . "$HOME/.bash_login"
elif [ -r "$HOME/.profile" ]; then . "$HOME/.profile"
else
  [ -r /etc/bash.bashrc ] && . /etc/bash.bashrc
  [ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"
fi
__voltius_pwd() { printf '\e]7;file://%s%s\a' "$HOSTNAME" "$PWD"; }
case ";${PROMPT_COMMAND-};" in
  *";__voltius_pwd;"*) ;;
  *) PROMPT_COMMAND="__voltius_pwd${PROMPT_COMMAND:+;${PROMPT_COMMAND}}" ;;
esac
__voltius_pwd 2>/dev/null
EOF
  exec bash --rcfile "$RCFILE_TMP" -i </dev/tty
  else
  # No bash on the remote (busybox/dash-only host). Hooking OSC 7 into a POSIX
  # sh via an $ENV file keeps integration working; without this branch the
  # `exec bash` above would fail with 127, the sh would exit, and the session
  # would loop disconnect/reconnect.
  ENVF=$(mktemp 2>/dev/null) || exec sh -i </dev/tty
  cat > "$ENVF" <<'EOF'
__voltius_pwd() { printf '\033]7;file://%s%s\007' "${HOSTNAME:-}" "$PWD"; }
PS1='$(__voltius_pwd)'"${PS1:-$ }"
EOF
  ENV="$ENVF" exec sh -i </dev/tty
  fi
  ;;
esac
"#;

/// sshd emits the MOTD only for an interactive `shell` request, not the `exec`
/// path integration/persistence use, so reproduce it. Single quote-free line so
/// it can embed in the persist inner; respects ~/.hushlogin.
pub const MOTD_PREAMBLE: &str = "[ ! -e $HOME/.hushlogin ] && { [ -r /run/motd.dynamic ] && cat /run/motd.dynamic; [ -r /etc/motd ] && cat /etc/motd; }";

/// Build the SSH exec payload. The remote login shell (whatever it may be:
/// bash, zsh, fish, csh, dash) only needs to parse `echo ... | base64 -d |
/// sh` — a syntax common to every Unix shell. The decoded POSIX wrapper then
/// runs under /bin/sh and execs into the user's actual shell with OSC 7
/// emission hooked.
pub fn ssh_exec_command() -> String {
    encode_wrapper(&format!("{MOTD_PREAMBLE}\n{SSH_WRAPPER}"))
}

const TMUX_SOCKET: &str = "voltius";

/// tmux/screen session name for a session id, sanitized to `[A-Za-z0-9_-]`.
/// Stable across reconnect so the multiplexer re-attaches the live session.
pub fn tmux_session_key(session_id: &str) -> String {
    let sanitized: String = session_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("voltius_{sanitized}")
}

/// Wrap `inner` (the existing exec bootstrap) in tmux, else screen, else a
/// plain shell. `inner` must contain no double quotes: it is embedded in the
/// double-quoted multiplexer command. The outer sh's stdin is the base64
/// pipe, so the pty is re-attached with `<&2`: stderr still holds the
/// original pty file description sshd created. Re-opening the device by path
/// (`</dev/tty` or the pts path) breaks modern tmux — 3.4+ rejects
/// `/dev/tty` outright ("can't use /dev/tty"), and a fresh open of the pts
/// makes the server's redraw writes vanish, leaving a connected-but-blank
/// terminal. Duplicating the inherited description avoids both.
///
/// The screen branch first self-heals: `screen -wipe` clears `Dead ???`
/// entries left by abrupt drops, and any same-named duplicates are collapsed to
/// one server. Unlike tmux's server-serialized `new-session -A`, `screen -D -R`
/// has no name-collision protection — concurrent connects can create duplicates,
/// and once two exist `-D -R` refuses to attach ("several suitable screens"),
/// which closes the channel and feeds the reconnect loop into spawning more.
pub fn persistent_exec_command(session_key: &str, inner: &str) -> String {
    let script = format!(
        r#"if command -v tmux >/dev/null 2>&1; then
  TMUX_CONF=$(mktemp 2>/dev/null)
  if [ -n "$TMUX_CONF" ]; then
    cat > "$TMUX_CONF" <<'EOF'
set -g status off
set -g mouse on
set -g default-terminal "xterm-256color"
set -g history-limit 50000
set -sg escape-time 0
set -g destroy-unattached off
EOF
    exec tmux -L {socket} -f "$TMUX_CONF" new-session -A -s {key} "{inner}" <&2
  fi
  exec tmux -L {socket} new-session -A -s {key} "{inner}" <&2
elif command -v screen >/dev/null 2>&1; then
  screen -wipe >/dev/null 2>&1
  for d in $(screen -ls 2>/dev/null | grep -F .{key} | awk '{{print $1}}' | tail -n +2); do
    screen -S "$d" -X quit >/dev/null 2>&1
  done
  SCREEN_RC=$(mktemp 2>/dev/null)
  if [ -n "$SCREEN_RC" ]; then
    cat > "$SCREEN_RC" <<'EOF'
startup_message off
msgwait 0
msgminwait 0
vbell off
defscrollback 50000
termcapinfo xterm* ti@:te@
EOF
    exec screen -c "$SCREEN_RC" -S {key} -D -R sh -c "{inner}" <&2
  fi
  exec screen -S {key} -D -R sh -c "{inner}" <&2
else
  printf '\r\n[voltius] tmux/screen not found - session will not survive disconnects\r\n'
  exec sh -c "{inner}" <&2
fi
"#,
        socket = TMUX_SOCKET,
        key = session_key,
        inner = inner,
    );
    encode_wrapper(&script)
}

/// Best-effort kill of the persistent multiplexer session for `session_key`.
/// The wrapper picks tmux or screen at runtime, so we target both and swallow
/// errors. Socket/server flags MUST mirror `persistent_exec_command`:
/// tmux on the `-L voltius` socket, screen by `-S <key>`.
pub fn persistent_kill_command(session_key: &str) -> String {
    format!(
        "tmux -L {socket} kill-session -t {key} 2>/dev/null; \
         screen -S {key} -X quit 2>/dev/null; true",
        socket = TMUX_SOCKET,
        key = session_key,
    )
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

/// Container wrapper (docker exec / pct exec). Like SSH_WRAPPER, but:
///   - It must survive minimal images: bash often isn't present, so the
///     fallback is a POSIX `sh` whose `$ENV` startup file hooks OSC 7 into PS1
///     via command substitution (`$(__voltius_pwd)` re-runs every prompt and
///     emits the sequence — portable across dash and busybox ash).
///   - No `</dev/tty` is needed: it's run via `eval "$(… | base64 -d)"`, so the
///     wrapping shell keeps the container TTY on stdin and `exec sh -i`
///     inherits it directly (no pipe to escape from).
const CONTAINER_WRAPPER: &str = r#"if command -v bash >/dev/null 2>&1; then
  RC=$(mktemp 2>/dev/null || echo /tmp/.voltius_rc)
  cat > "$RC" <<'EOF'
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
__voltius_pwd() { printf '\033]7;file://%s%s\007' "${HOSTNAME:-}" "$PWD"; }
case ";${PROMPT_COMMAND-};" in
  *";__voltius_pwd;"*) ;;
  *) PROMPT_COMMAND="__voltius_pwd${PROMPT_COMMAND:+;${PROMPT_COMMAND}}" ;;
esac
__voltius_pwd 2>/dev/null
EOF
  exec bash --rcfile "$RC" -i
else
  ENVF=$(mktemp 2>/dev/null || echo /tmp/.voltius_env)
  cat > "$ENVF" <<'EOF'
__voltius_pwd() { printf '\033]7;file://%s%s\007' "${HOSTNAME:-}" "$PWD"; }
PROMPT_COMMAND="__voltius_pwd"
PS1='$(__voltius_pwd)'"${PS1:-$ }"
EOF
  ENV="$ENVF" exec sh -i
fi
"#;

/// Build the argument for `sh -c '<…>'` inside a container (the caller prefixes
/// `docker exec -it <cid>` or `pct exec <vmid> --`). Base64-decodes the wrapper
/// and `eval`s it (keeping the container TTY on stdin); if `base64` is missing,
/// falls back to a plain interactive shell so the session still opens.
pub fn container_exec_payload() -> String {
    use base64::engine::general_purpose;
    use base64::Engine;
    let encoded = general_purpose::STANDARD.encode(CONTAINER_WRAPPER);
    // Single-quote-free (only double quotes + base64 alphabet) so the caller can
    // safely wrap the whole thing in single quotes for the host shell.
    format!(
        "if command -v base64 >/dev/null 2>&1; then eval \"$(printf %s \"{encoded}\" | base64 -d)\"; else exec sh -i; fi"
    )
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
  cat > "$ZDOTDIR_TMP/.zshenv" <<'EOF'
if [ -n "${ZDOTDIR_ORIG-}" ]; then ZDOTDIR="$ZDOTDIR_ORIG"; else unset ZDOTDIR; fi
unset ZDOTDIR_ORIG
[ -f "${ZDOTDIR:-$HOME}/.zshenv" ] && source "${ZDOTDIR:-$HOME}/.zshenv"
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

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose;
    use base64::Engine;

    fn decode_bootstrap(cmd: &str) -> String {
        let b64 = cmd
            .strip_prefix("echo ")
            .and_then(|s| s.split(" |").next())
            .expect("bootstrap shape");
        String::from_utf8(general_purpose::STANDARD.decode(b64).unwrap()).unwrap()
    }

    #[test]
    fn session_key_sanitizes_unsafe_chars() {
        assert_eq!(tmux_session_key("abc-123"), "voltius_abc-123");
        assert_eq!(tmux_session_key("a.b:c d"), "voltius_a_b_c_d");
    }

    #[test]
    fn persistent_wrapper_embeds_inner_and_all_branches() {
        let inner = ssh_exec_command();
        let cmd = persistent_exec_command("voltius_s1", &inner);
        let script = decode_bootstrap(&cmd);
        assert!(script.contains("command -v tmux"));
        assert!(script.contains("tmux -L voltius"));
        assert!(script.contains("new-session -A -s voltius_s1"));
        assert!(script.contains("command -v screen"));
        assert!(script.contains("screen -S voltius_s1"));
        assert!(script.contains("screen -c"));
        // Self-heal: wipe dead entries and collapse same-named duplicates so
        // -D -R can't fail into the "several suitable screens" reconnect loop.
        assert!(script.contains("screen -wipe"));
        assert!(script.contains("grep -F .voltius_s1"));
        assert!(script.contains("-X quit"));
        assert!(script.contains("msgwait 0"));
        assert!(script.contains("ti@:te@"));
        assert!(script.contains("will not survive disconnects"));
        assert!(!inner.contains('"'));
        assert!(script.contains(&inner));
    }

    #[test]
    fn ssh_wrapper_reproduces_motd() {
        let decoded = decode_bootstrap(&ssh_exec_command());
        assert!(decoded.contains("/run/motd.dynamic"));
        assert!(decoded.contains("/etc/motd"));
        assert!(decoded.contains(".hushlogin"));
        // Quote-free so it can also be embedded in the persist inner.
        assert!(!MOTD_PREAMBLE.contains('"'));
    }

    #[test]
    fn persistent_kill_targets_both_multiplexers() {
        let key = tmux_session_key("s1");
        let cmd = persistent_kill_command(&key);
        assert!(cmd.contains("tmux -L voltius kill-session -t voltius_s1"));
        assert!(cmd.contains("screen -S voltius_s1 -X quit"));
        assert!(cmd.contains("2>/dev/null"));
        assert!(cmd.trim_end().ends_with("true"));
    }

    #[test]
    fn persistent_wrapper_keeps_dev_tty_redirects() {
        let inner = ssh_exec_command();
        let cmd = persistent_exec_command("voltius_s1", &inner);
        let script = decode_bootstrap(&cmd);
        assert!(script.contains("</dev/tty"));
        assert!(script.contains(&format!("exec sh -c \"{}\" </dev/tty", inner)));
    }

    #[test]
    fn ssh_wrapper_zsh_uses_zshenv_trampoline() {
        let decoded = decode_bootstrap(&ssh_exec_command());
        assert!(
            decoded.contains("$ZDOTDIR_TMP/.zshenv"),
            "SSH wrapper zsh branch must write .zshenv, got:\n{decoded}"
        );
        assert!(
            !decoded.contains("$ZDOTDIR_TMP/.zshrc"),
            "SSH wrapper must not write .zshrc, got:\n{decoded}"
        );
        assert!(
            decoded.contains("ZDOTDIR=\"$ZDOTDIR_ORIG\""),
            "SSH wrapper must restore ZDOTDIR from ZDOTDIR_ORIG, got:\n{decoded}"
        );
        assert!(
            decoded.contains("${ZDOTDIR:-$HOME}/.zshenv"),
            "SSH wrapper must source real .zshenv, got:\n{decoded}"
        );
        assert!(
            !decoded.contains("${ZDOTDIR_ORIG}/.zshrc"),
            "SSH wrapper must not manually source user .zshrc, got:\n{decoded}"
        );
        assert!(
            decoded.contains("file://%s%s") && decoded.contains("${HOST}"),
            "SSH wrapper must use HOST-based OSC 7 printf, got:\n{decoded}"
        );
    }

    #[test]
    fn wsl_wrapper_zsh_uses_zshenv_trampoline() {
        let decoded = decode_bootstrap(&wsl_exec_command());
        assert!(
            decoded.contains("$ZDOTDIR_TMP/.zshenv"),
            "WSL wrapper zsh branch must write .zshenv, got:\n{decoded}"
        );
        assert!(
            !decoded.contains("$ZDOTDIR_TMP/.zshrc"),
            "WSL wrapper must not write .zshrc, got:\n{decoded}"
        );
        assert!(
            decoded.contains("ZDOTDIR=\"$ZDOTDIR_ORIG\""),
            "WSL wrapper must restore ZDOTDIR from ZDOTDIR_ORIG, got:\n{decoded}"
        );
        assert!(
            decoded.contains("${ZDOTDIR:-$HOME}/.zshenv"),
            "WSL wrapper must source real .zshenv, got:\n{decoded}"
        );
        assert!(
            !decoded.contains("${ZDOTDIR_ORIG}/.zshrc"),
            "WSL wrapper must not manually source user .zshrc, got:\n{decoded}"
        );
        assert!(
            decoded.contains("wsl.localhost"),
            "WSL wrapper must keep wsl.localhost printf, got:\n{decoded}"
        );
    }

    #[test]
    fn prepare_local_zsh_writes_zshenv() {
        let session_id = format!("test-zshenv-{}", std::process::id());
        let result = prepare_local("/bin/zsh", &session_id).expect("prepare_local failed");
        let integration = result.expect("expected Some(LocalIntegration) for zsh");

        let zdotdir = integration
            .env
            .iter()
            .find(|(k, _)| k == "ZDOTDIR")
            .map(|(_, v)| std::path::PathBuf::from(v))
            .expect("ZDOTDIR env var not set");

        let zshenv_path = zdotdir.join(".zshenv");
        assert!(
            zshenv_path.exists(),
            ".zshenv must be written at {zshenv_path:?}"
        );
        assert!(
            !zdotdir.join(".zshrc").exists(),
            ".zshrc must not be written, got it at {:?}",
            zdotdir.join(".zshrc")
        );

        let content = std::fs::read_to_string(&zshenv_path).expect("failed to read .zshenv");
        assert!(
            content.contains("${ZDOTDIR:-$HOME}/.zshenv"),
            ".zshenv must source real .zshenv, got:\n{content}"
        );
        assert!(
            content.contains("ZDOTDIR=\"$ZDOTDIR_ORIG\""),
            ".zshenv must restore ZDOTDIR, got:\n{content}"
        );

        cleanup(&integration.tempfiles);
        assert!(!zdotdir.exists(), "cleanup must remove temp dir");
    }
}
