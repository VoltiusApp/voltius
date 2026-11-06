#!/usr/bin/env bash
# Fails unless every package Tauri built for $1 (target triple) in $2 (bundle dir) ships voltius-cli.
set -euo pipefail
shopt -s nullglob

triple="${1:?usage: check-cli-in-bundle.sh <target-triple> <bundle-dir>}"
bundle="${2:?usage: check-cli-in-bundle.sh <target-triple> <bundle-dir>}"

fail() { echo "check-cli-in-bundle: $*" >&2; exit 1; }

# Runs the checker on every match of glob $1; globs expand in this shell so fail aborts the script.
each() {
  local glob="$1" f
  shift
  # shellcheck disable=SC2206
  local matches=("$bundle"/$glob)
  ((${#matches[@]})) || fail "no $glob in $bundle"
  for f in "${matches[@]}"; do
    "$@" "$f" || fail "$f does not contain voltius-cli"
    echo "ok: $f"
  done
}

listing() {
  local pattern="$1" out rc=0
  shift
  out=$("$@" 2>&1) || rc=$?
  out=$(tr -d '\r' <<< "$out")
  grep -Eq "$pattern" <<< "$out" && return 0
  {
    echo "--- '$*' exited $rc; lines mentioning voltius (or the first 40):"
    grep -i voltius <<< "$out" || head -n 40 <<< "$out"
  } >&2
  return 1
}

appimage() {
  local abs work
  abs=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
  work=$(mktemp -d)
  chmod +x "$abs"
  local rc=0
  (cd "$work" && "$abs" --appimage-extract > /dev/null) || rc=$?
  [ -f "$work/squashfs-root/usr/bin/voltius-cli" ] || {
    echo "--- --appimage-extract exited $rc; squashfs-root/usr/bin holds:" >&2
    ls "$work/squashfs-root/usr/bin" >&2 || true
    rc=1
  }
  rm -rf "$work"
  return $rc
}

msi() {
  local dir
  dir=$(mktemp -d)
  # shellcheck disable=SC2016
  MSI=$(cygpath -w "$1") DIR=$(cygpath -w "$dir") powershell.exe -NoProfile -Command \
    '$p = Start-Process msiexec -Wait -PassThru -ArgumentList "/a","`"$env:MSI`"","/qn","TARGETDIR=`"$env:DIR`""; exit $p.ExitCode' \
    || return 1
  [ -n "$(find "$dir" -iname 'voltius-cli.exe' | head -n 1)" ] || {
    echo "--- no voltius-cli.exe in the extracted MSI; files named voltius*:" >&2
    find "$dir" -iname 'voltius*' >&2
    return 1
  }
}

case "$triple" in
  *linux*)
    each 'deb/*.deb' listing '/usr/bin/voltius-cli$' dpkg -c
    command -v rpm > /dev/null || fail "rpm is required to inspect the .rpm"
    each 'rpm/*.rpm' listing '/usr/bin/voltius-cli$' rpm -qlp
    each 'appimage/*.AppImage' appimage
    ;;
  *darwin*)
    each 'dmg/*.dmg' true
    cli="$bundle/macos/Voltius.app/Contents/MacOS/voltius-cli"
    [ -f "$cli" ] || fail "$cli is missing"
    case "$(uname -m):$triple" in
      arm64:aarch64-* | x86_64:x86_64-*) "$cli" --version > /dev/null || fail "$cli --version failed" ;;
    esac
    echo "ok: $cli"
    ;;
  *windows*)
    each 'nsis/*-setup.exe' listing '(^|[ /\\])voltius-cli\.exe$' 7z l
    each 'msi/*.msi' msi
    ;;
  *) fail "unknown target $triple" ;;
esac
