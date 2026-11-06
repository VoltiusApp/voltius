#!/usr/bin/env bash
# Every package family must fail on an empty bundle dir.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
stubs=$(mktemp -d)
for tool in rpm dpkg 7z; do printf '#!/bin/sh\nexit 0\n' > "$stubs/$tool"; chmod +x "$stubs/$tool"; done
status=0
for triple in x86_64-unknown-linux-gnu aarch64-apple-darwin x86_64-pc-windows-msvc; do
  empty=$(mktemp -d)
  if PATH="$stubs:$PATH" bash "$here/check-cli-in-bundle.sh" "$triple" "$empty"; then
    echo "FAIL: $triple passed on an empty bundle" >&2
    status=1
  else
    echo "ok: $triple rejected an empty bundle"
  fi
done
exit $status
