//! Host env vars reach the remote shell through a private temp file, so their
//! values never pass through the PTY: no echo, no scrollback, no shell history.

use crate::ssh::exec::{run_captured_with_stdin, shell_quote};
use russh::client::{Handle, Handler};
use std::time::Duration;

// The file's first line deletes it, so it is gone as soon as the shell sources it.
const STAGE_COMMAND: &str =
    r#"umask 077; f=$(mktemp) && { printf 'rm -f -- %s\n' "$f"; cat; } > "$f" && printf %s "$f""#;
const STAGE_TIMEOUT: Duration = Duration::from_secs(5);

fn is_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    matches!(chars.next(), Some(c) if c == '_' || c.is_ascii_alphabetic())
        && chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

fn export_lines(vars: &[(String, String)]) -> String {
    vars.iter()
        .filter(|(key, _)| is_env_key(key))
        .map(|(key, value)| format!("export {key}={}\n", shell_quote(value)))
        .collect()
}

fn staged_path(stdout: &[u8]) -> Option<&str> {
    let path = std::str::from_utf8(stdout).ok()?.trim();
    let safe = path
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"/._-".contains(&b));
    (path.starts_with('/') && safe).then_some(path)
}

fn typed_exports(exports: &str) -> String {
    exports.lines().map(|line| format!(" {line}\n")).collect()
}

/// What to type into the shell to load `vars`: one line sourcing a staged temp
/// file, or space-prefixed exports when the host can't stage one.
pub(crate) async fn startup_input<H: Handler>(
    handle: &Handle<H>,
    vars: &[(String, String)],
) -> String {
    let exports = export_lines(vars);
    if exports.is_empty() {
        return String::new();
    }
    let staged = tokio::time::timeout(
        STAGE_TIMEOUT,
        run_captured_with_stdin(handle, STAGE_COMMAND, Some(exports.as_bytes())),
    )
    .await;
    match staged {
        Ok(Ok(out)) if out.code == Some(0) => staged_path(&out.stdout).map(|p| format!(" . {p}\n")),
        _ => None,
    }
    .unwrap_or_else(|| typed_exports(&exports))
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::ssh::exec::run_captured;
    use crate::ssh::test_proc_server::{proc_server, ProcOptions};

    fn vars(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
        pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect()
    }

    #[test]
    fn invalid_keys_are_dropped_and_values_quoted() {
        let out = export_lines(&vars(&[
            ("GOOD", "it's $HOME"),
            ("1BAD", "x"),
            ("A;rm -rf ~", "x"),
            ("_ok2", ""),
        ]));
        assert_eq!(out, "export GOOD='it'\\''s $HOME'\nexport _ok2=''\n");
    }

    #[test]
    fn only_plain_absolute_paths_are_trusted() {
        assert_eq!(
            staged_path(b"/tmp/tmp.Ab12_x-9\n"),
            Some("/tmp/tmp.Ab12_x-9")
        );
        assert_eq!(staged_path(b"tmp/rel"), None);
        assert_eq!(staged_path(b"/tmp/a b"), None);
        assert_eq!(staged_path(b"/tmp/$(x)"), None);
        assert_eq!(staged_path(b""), None);
    }

    #[test]
    fn the_fallback_space_prefixes_every_export() {
        assert_eq!(
            typed_exports("export A='1'\nexport B='2'\n"),
            " export A='1'\n export B='2'\n"
        );
    }

    #[tokio::test]
    async fn no_valid_vars_means_nothing_to_type() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        assert_eq!(startup_input(&handle, &vars(&[("1BAD", "x")])).await, "");
    }

    #[tokio::test]
    async fn staged_values_load_and_the_file_removes_itself() {
        let (handle, _) = proc_server(ProcOptions::default()).await;
        let input = startup_input(
            &handle,
            &vars(&[("GREETING", "hello 'world' $HOME"), ("EMPTY", "")]),
        )
        .await;
        assert!(
            !input.contains("hello"),
            "values must not be typed: {input}"
        );
        let path = input.trim().strip_prefix(". ").unwrap().to_owned();
        let mode = run_captured(
            &handle,
            &format!("stat -c %a {path} 2>/dev/null || stat -f %Lp {path}"),
        )
        .await
        .unwrap();
        assert_eq!(mode.stdout_text().trim(), "600");
        let out = run_captured(
            &handle,
            &format!(". {path}; printf '%s|%s|' \"$GREETING\" \"${{EMPTY-unset}}\"; test -e {path} || echo gone"),
        )
        .await
        .unwrap();
        assert_eq!(out.stdout_text(), "hello 'world' $HOME||gone\n");
    }
}
