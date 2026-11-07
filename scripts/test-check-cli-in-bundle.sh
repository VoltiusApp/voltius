#!/usr/bin/env bash
# Every package family must fail on an empty bundle dir, and Linux listings must match by path, not by format.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
stubs=$(mktemp -d)
for tool in rpm dpkg 7z; do printf '#!/bin/sh\nprintf "%%s\\n" "$LISTING"\n' > "$stubs/$tool"; chmod +x "$stubs/$tool"; done
status=0

expect() {
  local want="$1" label="$2" got=0
  shift 2
  PATH="$stubs:$PATH" "$@" > /dev/null 2>&1 || got=1
  if [ "$got" = "$want" ]; then echo "ok: $label"; else echo "FAIL: $label" >&2; status=1; fi
}

for triple in x86_64-unknown-linux-gnu aarch64-apple-darwin x86_64-pc-windows-msvc; do
  expect 1 "$triple rejects an empty bundle" env LISTING= bash "$here/check-cli-in-bundle.sh" "$triple" "$(mktemp -d)"
done

linux=$(mktemp -d)
mkdir -p "$linux/deb" "$linux/rpm" "$linux/appimage"
touch "$linux/deb/v.deb" "$linux/rpm/v.rpm"
printf '#!/bin/sh\nmkdir -p squashfs-root/usr/bin && touch squashfs-root/usr/bin/voltius-cli\n' > "$linux/appimage/v.AppImage"
for line in '-rwxr-xr-x 0/0 1 2026-11-06 22:19 usr/bin/voltius-cli' \
            '-rwxr-xr-x 0/0 1 2026-11-06 22:19 ./usr/bin/voltius-cli' \
            '/usr/bin/voltius-cli'; do
  expect 0 "accepts '$line'" env LISTING="$line" bash "$here/check-cli-in-bundle.sh" x86_64-unknown-linux-gnu "$linux"
done
for line in 'usr/bin/voltius-cli-x86_64-unknown-linux-gnu' 'usr/bin/voltius' 'usr/lib/voltius/usr/bin/voltius-clix'; do
  expect 1 "rejects '$line'" env LISTING="$line" bash "$here/check-cli-in-bundle.sh" x86_64-unknown-linux-gnu "$linux"
done
exit $status
