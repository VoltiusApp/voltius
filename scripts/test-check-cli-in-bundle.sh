#!/usr/bin/env bash
# Rejects must come from the checker's own fail() (not a crash), and every glob of every family must be reachable.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
stubs=$(mktemp -d)
for tool in rpm dpkg 7z; do printf '#!/bin/sh\nprintf "%%s\\n" "$LISTING"\n' > "$stubs/$tool"; chmod +x "$stubs/$tool"; done
status=0

# expect <0|1> <label> <stderr-regex for rejects, ignored for accepts> <command...>
expect() {
  local want="$1" label="$2" pattern="$3" got=0 err
  shift 3
  err=$(mktemp)
  PATH="$stubs:$PATH" "$@" > /dev/null 2> "$err" || got=1
  if [ "$got" = 1 ] && [ "$want" = 1 ] && ! grep -Eq "^check-cli-in-bundle: .*$pattern" "$err"; then
    got=crashed
  fi
  if [ "$got" = "$want" ]; then echo "ok: $label"; else echo "FAIL: $label (got $got)" >&2; cat "$err" >&2; status=1; fi
  rm -f "$err"
}

check() { env LISTING="$LISTING" bash "$here/check-cli-in-bundle.sh" "$@"; }

# mkbundle <dir> <file...>: creates the files; AppImages and the macOS CLI are runnable stubs.
mkbundle() {
  local dir="$1" f
  shift
  for f in "$@"; do
    mkdir -p "$dir/$(dirname "$f")"
    case "$f" in
      *.AppImage) printf '#!/bin/sh\nmkdir -p squashfs-root/usr/bin && touch squashfs-root/usr/bin/voltius-cli\n' > "$dir/$f" ;;
      */voltius-cli) printf '#!/bin/sh\nexit 0\n' > "$dir/$f" ;;
      *) touch "$dir/$f" ;;
    esac
    chmod +x "$dir/$f"
  done
}

# family <triple> <listing> <path>... : empty bundle and each single omission must be rejected for the omitted item.
family() {
  local triple="$1" listing="$2" i j files
  shift 2
  LISTING= expect 1 "$triple rejects an empty bundle" "(no |is missing)" check "$triple" "$(mktemp -d)"
  for i in "$@"; do
    files=()
    for j in "$@"; do [ "$j" = "$i" ] || files+=("$j"); done
    local dir
    dir=$(mktemp -d)
    mkbundle "$dir" "${files[@]}"
    LISTING="$listing" expect 1 "$triple rejects a bundle without $i" "(no ${i%%/*}/|${i##*/} is missing)" check "$triple" "$dir"
  done
}

family x86_64-unknown-linux-gnu 'usr/bin/voltius-cli' deb/v.deb rpm/v.rpm appimage/v.AppImage
family aarch64-apple-darwin '' dmg/v.dmg macos/Voltius.app/Contents/MacOS/voltius-cli
family x86_64-pc-windows-msvc 'voltius-cli.exe' nsis/v-setup.exe msi/v.msi

linux=$(mktemp -d)
mkbundle "$linux" deb/v.deb rpm/v.rpm appimage/v.AppImage
for line in '-rwxr-xr-x 0/0 1 2026-11-06 22:19 usr/bin/voltius-cli' \
            '-rwxr-xr-x 0/0 1 2026-11-06 22:19 ./usr/bin/voltius-cli' \
            '/usr/bin/voltius-cli'; do
  LISTING="$line" expect 0 "accepts '$line'" "" check x86_64-unknown-linux-gnu "$linux"
done
for line in 'usr/bin/voltius-cli-x86_64-unknown-linux-gnu' 'usr/bin/voltius' 'usr/bin/voltius-cli.bak'; do
  LISTING="$line" expect 1 "rejects '$line'" "does not contain voltius-cli" check x86_64-unknown-linux-gnu "$linux"
done

mac=$(mktemp -d)
mkbundle "$mac" dmg/v.dmg macos/Voltius.app/Contents/MacOS/voltius-cli
LISTING= expect 0 "accepts a complete macOS bundle" "" check aarch64-apple-darwin "$mac"

# msiexec is unavailable here, so NSIS acceptance is proven by the failure naming the msi glob, not the nsis one.
win=$(mktemp -d)
mkbundle "$win" nsis/v-setup.exe
LISTING='2026-11-06 22:19:00 ....A 1 1 voltius-cli.exe' expect 1 "accepts the NSIS listing and stops at the missing msi" "no msi/\*\.msi" check x86_64-pc-windows-msvc "$win"
LISTING='2026-11-06 22:19:00 ....A 1 1 voltius.exe' expect 1 "rejects an NSIS listing without voltius-cli.exe" "does not contain voltius-cli" check x86_64-pc-windows-msvc "$win"
exit $status
