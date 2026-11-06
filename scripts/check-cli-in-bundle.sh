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
  local matches
  mapfile -t matches < <(compgen -G "$bundle/$glob" || true)
  ((${#matches[@]})) || fail "no $glob in $bundle"
  for f in "${matches[@]}"; do
    "$@" "$f" || fail "$f does not contain voltius-cli"
    echo "ok: $f"
  done
}

listing() {
  local pattern="$1" out
  shift
  out=$("$@" | tr -d '\r')
  grep -Eq "$pattern" <<< "$out"
}

appimage() {
  local abs work
  abs=$(cd "$(dirname "$1")" && pwd)/$(basename "$1")
  work=$(mktemp -d)
  chmod +x "$abs"
  (cd "$work" && "$abs" --appimage-extract > /dev/null) && [ -f "$work/squashfs-root/usr/bin/voltius-cli" ]
  local rc=$?
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
  [ -n "$(find "$dir" -iname 'voltius-cli.exe' -print -quit)" ]
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
