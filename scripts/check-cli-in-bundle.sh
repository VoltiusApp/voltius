#!/usr/bin/env bash
# Fails unless every package Tauri built for $1 (target triple) in $2 (bundle dir) ships voltius-cli.
set -euo pipefail
shopt -s nullglob

triple="${1:?usage: check-cli-in-bundle.sh <target-triple> <bundle-dir>}"
bundle="${2:?usage: check-cli-in-bundle.sh <target-triple> <bundle-dir>}"

fail() { echo "check-cli-in-bundle: $*" >&2; exit 1; }

need() {
  local matches
  mapfile -t matches < <(compgen -G "$bundle/$1" || true)
  [ "${#matches[@]}" -gt 0 ] || fail "no $1 in $bundle"
  printf '%s\n' "${matches[@]}"
}

lists() {
  local what="$1" pattern="$2" listing
  shift 2
  listing=$("$@") || fail "could not list $what"
  grep -Eq "$pattern" <<< "$listing" || fail "$what does not contain voltius-cli"
  echo "ok: $what"
}

case "$triple" in
  *linux*)
    while IFS= read -r f; do lists "$f" '/usr/bin/voltius-cli$' dpkg -c "$f"; done < <(need 'deb/*.deb')
    command -v rpm > /dev/null || fail "rpm is required to inspect the .rpm"
    while IFS= read -r f; do lists "$f" '/usr/bin/voltius-cli$' rpm -qlp "$f"; done < <(need 'rpm/*.rpm')
    while IFS= read -r f; do
      work=$(mktemp -d)
      abs=$(cd "$(dirname "$f")" && pwd)/$(basename "$f")
      chmod +x "$abs"
      (cd "$work" && "$abs" --appimage-extract > /dev/null)
      [ -f "$work/squashfs-root/usr/bin/voltius-cli" ] || fail "$f does not contain voltius-cli"
      echo "ok: $f"
      rm -rf "$work"
    done < <(need 'appimage/*.AppImage')
    ;;
  *darwin*)
    need 'dmg/*.dmg' > /dev/null
    cli="$bundle/macos/Voltius.app/Contents/MacOS/voltius-cli"
    [ -f "$cli" ] || fail "$cli is missing"
    host=$(uname -m)
    case "$host:$triple" in
      arm64:aarch64-* | x86_64:x86_64-*) "$cli" --version > /dev/null || fail "$cli --version failed" ;;
    esac
    echo "ok: $cli"
    ;;
  *windows*)
    while IFS= read -r f; do lists "$f" '(^|[ /\\])voltius[-_]cli\.exe$' 7z l "$f"; done < <(need 'nsis/*-setup.exe')
    while IFS= read -r f; do lists "$f" '(^|[ /\\])voltius[-_]cli\.exe$' 7z l "$f"; done < <(need 'msi/*.msi')
    ;;
  *) fail "unknown target $triple" ;;
esac
