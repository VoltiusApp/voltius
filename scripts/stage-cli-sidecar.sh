#!/usr/bin/env bash
# Builds voltius-cli and stages it as the Tauri sidecar for $1 (target triple).
set -euo pipefail
triple="${1:?usage: stage-cli-sidecar.sh <target-triple>}"
ext=""
case "$triple" in *windows*) ext=".exe" ;; esac
cargo build --release -p voltius-cli --target "$triple"
mkdir -p src-tauri/binaries
cp "target/$triple/release/voltius-cli$ext" "src-tauri/binaries/voltius-cli-$triple$ext"
