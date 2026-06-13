#!/usr/bin/env bash
# Build the Voltius Android debug APK inside the voltius-android image.
# Usage: scripts/android-build.sh [ARCH]   (ARCH default: aarch64; e.g. armv7|x86_64|i686)
# Run from anywhere; resolves the repo root itself.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
ARCH="${1:-aarch64}"

docker build -f "$REPO/Dockerfile.android" -t voltius-android "$REPO"

docker run --rm -v "$REPO":/project voltius-android bash -c \
  "CI=true pnpm install && pnpm tauri android build --target ${ARCH} --apk --debug"

APK="$(find "$REPO/src-tauri/gen/android/app/build/outputs/apk" -name '*-debug.apk' | head -1)"
if [ -z "$APK" ]; then echo "ERROR: no debug APK produced" >&2; exit 1; fi
echo "APK: $APK"
