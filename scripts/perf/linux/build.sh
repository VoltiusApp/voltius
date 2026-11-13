#!/bin/bash
# usage: build.sh <worktree> <out-dir> <name> — release binary for benching; LTO off so base and branch rebuild fast
set -e
cd "$1"
[ -d node_modules/.pnpm ] || pnpm install --frozen-lockfile
mkdir -p "$2"
pnpm build > "$2/$3.vite.log" 2>&1
export CARGO_TARGET_DIR=${CARGO_TARGET_DIR:-$HOME/.cache/voltius-perf-target}
export CARGO_PROFILE_RELEASE_LTO=false CARGO_PROFILE_RELEASE_CODEGEN_UNITS=16
cargo build --release --features tauri/custom-protocol --manifest-path src-tauri/Cargo.toml > "$2/$3.cargo.log" 2>&1
cp "$CARGO_TARGET_DIR/release/voltius" "$2/$3"
echo "built $2/$3"
