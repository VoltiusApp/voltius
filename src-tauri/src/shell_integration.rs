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
                // GNU bash requires long options before short options;
                // `bash -i --rcfile FILE` errors with "--: invalid option".
                args: vec![
                    "--rcfile".into(),
                    rc_path.to_string_lossy().into_owned(),
                    "-i".into(),
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
/// The `<&2` on every exec is load-bearing: when run via
/// `echo b64 | base64 -d | sh`, the inner sh's stdin is the pipe from
/// base64. After exec, the new shell would inherit that already-closed pipe
/// and immediately exit on EOF (printing "exit" and looping reconnect).
/// Duplicating stderr — which still holds the pty file description sshd
/// created — restores the real PTY.
///
/// Do NOT reopen by path (`</dev/tty`): that creates a *different* file
/// description of the tty, and sudo's `use_pty` mode (default on modern
/// Ubuntu/Debian) then fails to recognize the shell's stdin as the user's
/// terminal. Input handling splits between sudo's pty relay and the command,
/// and most keystrokes are silently lost inside `sudo -i` (a key had to be
/// pressed several times for one to register). Same reasoning as the
/// persistent wrapper's `<&2` (see `persistent_exec_command`).
///
/// The temp file leaks intentionally — /tmp is cleared on reboot, and trying
/// to rm it from inside the rcfile races with bash/zsh reading it.
const SSH_WRAPPER: &str = r#"case "$(basename "${SHELL:-/bin/sh}")" in
zsh)
  ZDOTDIR_TMP=$(mktemp -d 2>/dev/null) || exec zsh -l -i <&2
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
  ZDOTDIR="$ZDOTDIR_TMP" exec zsh -l -i <&2
  ;;
fish)
  exec fish -l -i <&2
  ;;
*)
  if command -v bash >/dev/null 2>&1; then
  RCFILE_TMP=$(mktemp 2>/dev/null) || exec bash -l -i <&2
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
  exec bash --rcfile "$RCFILE_TMP" -i <&2
  else
  # No bash on the remote (busybox/dash-only host). Hooking OSC 7 into a POSIX
  # sh via an $ENV file keeps integration working; without this branch the
  # `exec bash` above would fail with 127, the sh would exit, and the session
  # would loop disconnect/reconnect.
  ENVF=$(mktemp 2>/dev/null) || exec sh -i <&2
  cat > "$ENVF" <<'EOF'
__voltius_pwd() { printf '\033]7;file://%s%s\007' "${HOSTNAME:-}" "$PWD"; }
PS1='$(__voltius_pwd)'"${PS1:-$ }"
EOF
  ENV="$ENVF" exec sh -i <&2
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
///
/// Create path only: session keys derive from fresh UUIDs, so `-A`/`-D -R`
/// never meet a session another device is attached to. Re-attach and
/// cross-device join go through `persistent_attach_command`.
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

/// Attach-only wrapper: co-attaches a live session (tmux plain attach, screen
/// `-x` multi-display) and NEVER creates one — `persistent_probe_command` runs
/// first, so reaching the fallthrough means the session died in between; the
/// exit just closes the channel and the caller re-probes.
pub fn persistent_attach_command(session_key: &str) -> String {
    let script = format!(
        r#"if command -v tmux >/dev/null 2>&1 && tmux -L {socket} has-session -t {key} 2>/dev/null; then
  exec tmux -L {socket} attach-session -t {key} <&2
elif command -v screen >/dev/null 2>&1; then
  exec screen -x -S {key} <&2
fi
printf '\r\n[voltius] session has ended\r\n'
exit 97
"#,
        socket = TMUX_SOCKET,
        key = session_key,
    );
    encode_wrapper(&script)
}

/// One-shot existence probe mirroring the wrapper's tmux-first order. Prints
/// VOLTIUS_PRESENT when the session is alive; `screen -wipe` first so a dead
/// entry left by a crash doesn't read as present.
pub fn persistent_probe_command(session_key: &str) -> String {
    let script = format!(
        r#"if command -v tmux >/dev/null 2>&1 && tmux -L {socket} has-session -t {key} 2>/dev/null; then
  printf VOLTIUS_PRESENT
elif command -v screen >/dev/null 2>&1; then
  screen -wipe >/dev/null 2>&1
  screen -ls 2>/dev/null | grep -qF .{key} && printf VOLTIUS_PRESENT
fi
true"#,
        socket = TMUX_SOCKET,
        key = session_key,
    );
    encode_wrapper(&script)
}

/// One-shot exec that dumps the scrollback history of a persistent session,
/// picking the backend at runtime to mirror `persistent_exec_command`.
///
/// tmux: `capture-pane -peJ -S -50000 -E -1` — history from 50k lines back up
/// to just above the visible screen (`-E -1`), which the attach redraw repaints
/// anyway. `-p` prints to stdout, `-e` preserves SGR attributes, `-J` joins
/// wrapped lines.
///
/// screen: no stdout dump exists, so `hardcopy -h` writes the scrollback (plus
/// the live screen) to a temp file. `-X` is async — the session backend writes
/// the file — so we poll until its size settles before reading. The dump is
/// plain text (screen strips SGR) and includes the visible viewport, so
/// `head -n -<rows>` trims the last `pty_rows` lines to match tmux's `-E -1`
/// and avoid duplicating the redraw. `head -n -N` is GNU coreutils; on BSD head
/// it no-ops harmlessly (no trim).
///
/// Exits silently when the multiplexer or session is gone (host rebooted): the
/// capture is empty and the caller skips replay.
pub fn capture_history_command(session_key: &str, pty_rows: u32) -> String {
    format!(
        r#"if command -v tmux >/dev/null 2>&1 && tmux -L {socket} has-session -t {key} 2>/dev/null; then
  tmux -L {socket} capture-pane -t {key} -peJ -S -50000 -E -1 2>/dev/null
elif command -v screen >/dev/null 2>&1; then
  f=$(mktemp 2>/dev/null) || exit 0
  screen -S {key} -X hardcopy -h "$f" 2>/dev/null
  for i in $(seq 1 15); do
    a=$(wc -c <"$f" 2>/dev/null); sleep 0.1; b=$(wc -c <"$f" 2>/dev/null)
    [ "$a" = "$b" ] && break
  done
  head -n -{rows} "$f" 2>/dev/null
  rm -f "$f"
fi
true"#,
        socket = TMUX_SOCKET,
        key = session_key,
        rows = pty_rows,
    )
}

/// One-shot exec that resolves the current working directory of a persistent
/// session, used to drive the SFTP panel's "follow cwd" when the multiplexer
/// swallows the shell's OSC 7: GNU screen never forwards OSC 7 to the outer
/// terminal, and tmux consumes it for `#{pane_current_path}` rather than
/// passing it through. tmux is queried directly; screen has no cwd query, so we
/// descend the session's process tree to the foreground process and read
/// `/proc/<pid>/cwd` (Linux only — screen+cwd on macOS has no /proc and is
/// unsupported). Prints the absolute path on success, nothing otherwise.
pub fn cwd_probe_command(session_key: &str) -> String {
    let script = format!(
        r#"if command -v tmux >/dev/null 2>&1 && tmux -L {socket} has-session -t {key} 2>/dev/null; then
  tmux -L {socket} display-message -p -t {key} '#{{pane_current_path}}'
elif command -v screen >/dev/null 2>&1; then
  spid=$(screen -ls 2>/dev/null | grep -F .{key} | head -n1 | awk '{{print $1}}' | cut -d. -f1)
  if [ -n "$spid" ]; then
    pid=$spid
    cwd=""
    # Descend the tree to the foreground process. The window's wrapper sh pipes
    # into the real shell, so the interactive shell is a grandchild — the direct
    # child keeps a stale login cwd. Track the last process with a readable cwd
    # so transient/dead leaves and cwd-less wrappers are skipped.
    while :; do
      c=$(pgrep -P "$pid" 2>/dev/null | tail -n1)
      [ -n "$c" ] || c=$(ps -o pid= --ppid "$pid" 2>/dev/null | tail -n1 | tr -d ' ')
      [ -n "$c" ] || break
      pid=$c
      cur=$(readlink /proc/$pid/cwd 2>/dev/null)
      [ -n "$cur" ] && cwd=$cur
    done
    [ -n "$cwd" ] && printf '%s\n' "$cwd"
  fi
fi
true"#,
        socket = TMUX_SOCKET,
        key = session_key,
    );
    encode_wrapper(&script)
}

/// Conditional kill for a shared session. Kills only when at most
/// `max_clients` clients are attached (1 when the closer's own channel is
/// still attached, 0 when it already dropped) — another device's live attach
/// must survive a local tab close. Prints VOLTIUS_KILLED on confirmed kill,
/// and also when the session is already gone (host rebooted: tombstoning it
/// is accurate). No portable client count exists for screen; the frontend's
/// manifest gate is the only protection there. Socket/server flags MUST
/// mirror `persistent_exec_command`.
pub fn persistent_kill_command(session_key: &str, max_clients: usize) -> String {
    let script = format!(
        r#"K=0
if command -v tmux >/dev/null 2>&1 && tmux -L {socket} has-session -t {key} 2>/dev/null; then
  if [ "$(tmux -L {socket} list-clients -t {key} 2>/dev/null | grep -c .)" -le {max} ]; then
    tmux -L {socket} kill-session -t {key} 2>/dev/null && K=1
  fi
elif command -v screen >/dev/null 2>&1 && screen -ls 2>/dev/null | grep -qF .{key}; then
  screen -S {key} -X quit >/dev/null 2>&1 && K=1
else
  K=1
fi
[ "$K" = "1" ] && printf VOLTIUS_KILLED
true"#,
        socket = TMUX_SOCKET,
        key = session_key,
        max = max_clients,
    );
    encode_wrapper(&script)
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
  ZDOTDIR_TMP=$(mktemp -d 2>/dev/null) || exec zsh -i <&2
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
  ZDOTDIR="$ZDOTDIR_TMP" exec zsh -i <&2
  ;;
fish)
  exec fish -i -C 'function __voltius_wsl_pwd --on-event fish_prompt; printf "\e]7;file://wsl.localhost/%s%s\a" "$WSL_DISTRO_NAME" "$PWD"; end' <&2
  ;;
*)
  RCFILE_TMP=$(mktemp 2>/dev/null) || exec bash -i <&2
  cat > "$RCFILE_TMP" <<'EOF'
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"
__voltius_pwd() { printf '\e]7;file://wsl.localhost/%s%s\a' "$WSL_DISTRO_NAME" "$PWD"; }
case ";${PROMPT_COMMAND-};" in
  *";__voltius_pwd;"*) ;;
  *) PROMPT_COMMAND="__voltius_pwd${PROMPT_COMMAND:+;${PROMPT_COMMAND}}" ;;
esac
__voltius_pwd 2>/dev/null
EOF
  exec bash --rcfile "$RCFILE_TMP" -i <&2
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
        // Shared sessions: creating must never detach another device's client.
        assert!(!script.contains(" -D -s"));
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
    fn persistent_attach_joins_without_stealing_or_creating() {
        let script = decode_bootstrap(&persistent_attach_command("voltius_s1"));
        assert!(script.contains("tmux -L voltius has-session -t voltius_s1"));
        assert!(script.contains("attach-session -t voltius_s1"));
        // Co-attach: never detach the other device, never create a session.
        assert!(!script.contains("new-session"));
        assert!(!script.contains("-D"));
        assert!(script.contains("screen -x -S voltius_s1"));
        // Re-attach over the stderr pty (`<&2`); modern tmux rejects `</dev/tty`.
        assert!(script.contains("<&2"));
    }

    #[test]
    fn persistent_probe_detects_both_multiplexers() {
        let script = decode_bootstrap(&persistent_probe_command("voltius_s1"));
        assert!(script.contains("tmux -L voltius has-session -t voltius_s1"));
        // Dead screen entries must not read as present (attach -x would fail).
        assert!(script.contains("screen -wipe"));
        assert!(script.contains("grep -qF .voltius_s1"));
        assert!(script.contains("VOLTIUS_PRESENT"));
        assert!(script.trim_end().ends_with("true"));
    }

    #[test]
    fn persistent_kill_is_conditional_and_reports() {
        let key = tmux_session_key("s1");
        let attached = decode_bootstrap(&persistent_kill_command(&key, 1));
        let detached = decode_bootstrap(&persistent_kill_command(&key, 0));
        // Kill only when no client beyond the closer's own is attached.
        assert!(attached.contains("-le 1"));
        assert!(detached.contains("-le 0"));
        assert!(attached.contains("list-clients -t voltius_s1"));
        assert!(attached.contains("tmux -L voltius kill-session -t voltius_s1"));
        assert!(attached.contains("screen -S voltius_s1 -X quit"));
        // Confirmed kill (or already gone) prints the sentinel for the tombstone.
        assert!(attached.contains("VOLTIUS_KILLED"));
        assert!(attached.trim_end().ends_with("true"));
    }

    #[test]
    fn persistent_wrapper_keeps_pty_redirects() {
        let inner = ssh_exec_command();
        let cmd = persistent_exec_command("voltius_s1", &inner);
        let script = decode_bootstrap(&cmd);
        // The multiplexer re-attaches over the stderr pty (`<&2`), not `/dev/tty`.
        assert!(script.contains("<&2"));
        assert!(script.contains(&format!("exec sh -c \"{}\" <&2", inner)));
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
    fn capture_history_dumps_tmux_history_excluding_visible_screen() {
        let cmd = capture_history_command("voltius_s1", 40);
        assert!(cmd.contains("tmux -L voltius capture-pane -t voltius_s1"));
        // History only: from 50k lines back (-S) to just above the visible
        // screen (-E -1) so the live redraw after attach doesn't duplicate.
        assert!(cmd.contains("-S -50000"));
        assert!(cmd.contains("-E -1"));
        // -p print to stdout, -e keep SGR colors, -J join wrapped lines.
        assert!(cmd.contains("-peJ"));
        // Only run tmux when the session actually exists on the socket.
        assert!(cmd.contains("tmux -L voltius has-session -t voltius_s1"));
        // Missing multiplexer/session must not error the channel.
        assert!(cmd.contains("2>/dev/null"));
        assert!(cmd.trim_end().ends_with("true"));
    }

    #[test]
    fn cwd_probe_queries_tmux_and_descends_screen_proc() {
        let script = decode_bootstrap(&cwd_probe_command("voltius_s1"));
        // tmux: query pane_current_path on our private socket/session.
        assert!(script.contains("tmux -L voltius has-session -t voltius_s1"));
        assert!(script.contains("display-message -p -t voltius_s1 '#{pane_current_path}'"));
        // screen has no cwd query: find the server pid, descend the process
        // tree, and read /proc/<pid>/cwd.
        assert!(script.contains("screen -ls"));
        assert!(script.contains("grep -F .voltius_s1"));
        assert!(script.contains("pgrep -P"));
        assert!(script.contains("ps -o pid= --ppid"));
        assert!(script.contains("readlink /proc/$pid/cwd"));
        // Track the last readable cwd so wrapper shells (stale login cwd) and
        // transient/dead leaves don't win over the real interactive shell.
        assert!(script.contains("[ -n \"$cur\" ] && cwd=$cur"));
        // Never errors the channel; ends clean for the caller's read loop.
        assert!(script.contains("2>/dev/null"));
        assert!(script.trim_end().ends_with("true"));
    }

    #[test]
    fn capture_history_falls_back_to_screen_hardcopy() {
        let cmd = capture_history_command("voltius_s1", 40);
        // screen has no stdout dump; hardcopy -h writes scrollback to a temp file.
        assert!(cmd.contains("screen -S voltius_s1 -X hardcopy -h"));
        // Trim the live viewport (pty_rows) so the attach redraw isn't duplicated.
        assert!(cmd.contains("head -n -40"));
        // Gated behind screen availability, after the tmux branch.
        assert!(cmd.contains("elif command -v screen >/dev/null 2>&1; then"));
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

    #[test]
    fn prepare_local_bash_passes_long_option_before_short() {
        // GNU bash rejects a `--long` option that appears after a short option
        // (`bash -i --rcfile FILE` => "bash: --: invalid option"). The rcfile
        // long option must come before `-i`.
        let session_id = format!("test-bashrc-{}", std::process::id());
        let integration = prepare_local("/usr/bin/bash", &session_id)
            .expect("prepare_local failed")
            .expect("expected Some(LocalIntegration) for bash");

        let rcfile_pos = integration
            .args
            .iter()
            .position(|a| a == "--rcfile")
            .expect("--rcfile arg missing");
        let i_pos = integration
            .args
            .iter()
            .position(|a| a == "-i")
            .expect("-i arg missing");
        assert!(
            rcfile_pos < i_pos,
            "--rcfile must precede -i, got args: {:?}",
            integration.args
        );

        cleanup(&integration.tempfiles);
    }
}
