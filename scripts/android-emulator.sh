#!/usr/bin/env bash
# Bring up a headless Android emulator in Docker (system-image ABI matches the
# host arch — x86_64 or arm64) and load the Voltius debug APK into it, ready for
# the tauri-android MCP. One-shot: build image → build matching-arch APK → run
# container → wait for boot → install.
#
# The APK is built BEFORE the emulator boots: the cargo+gradle build is RAM-heavy
# and the emulator holds ~2.5 GB, so running both at once OOM-kills the emulator
# (exit 137). Sequencing them keeps the peak down.
#
# Usage: scripts/android-emulator.sh [--no-apk]
#   --no-apk   skip the APK build/install (just boot the emulator)
#
# Requires /dev/kvm (KVM accel — verified on x86_64 WSL2; check `ls /dev/kvm` on
# ARM-WSL2, where nested-virt exposure is less mature).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
NAME=android-emulator
SKIP_APK="${1:-}"

[ -e /dev/kvm ] || { echo "ERROR: /dev/kvm missing — emulator needs KVM accel." >&2; exit 1; }

echo "==> Building emulator image (cached after first run)…"
docker build -f "$REPO/Dockerfile.android-emulator" -t voltius-emulator "$REPO"

# The emulator system-image ABI matches the host arch (the Dockerfile picks it
# from uname), so the APK must target that same arch: aarch64 on an ARM box,
# x86_64 on an Intel/AMD box. Anything else won't install on the guest.
case "$(uname -m)" in
  aarch64|arm64) APK_TARGET=aarch64 ;;
  x86_64|amd64)  APK_TARGET=x86_64 ;;
  *) echo "ERROR: unsupported host arch $(uname -m) (need x86_64 or arm64)." >&2; exit 1 ;;
esac

# Build the APK first, while the emulator is NOT running (avoids the OOM peak).
APK=""
if [ "$SKIP_APK" = "--no-apk" ]; then
  echo "==> --no-apk: skipping APK build/install."
else
  echo "==> Building ${APK_TARGET} debug APK (before booting emulator)…"
  # --target ${APK_TARGET} compiles only that rust lib; tauri still emits the
  # single "universal" flavor APK (no --split-per-abi), which here contains just
  # the matching .so and installs on the emulator.
  "$REPO/scripts/android-build.sh" "$APK_TARGET"
  APK="$(find "$REPO/src-tauri/gen/android/app/build/outputs/apk" -name '*-debug.apk' | head -1)"
  [ -n "$APK" ] || { echo "ERROR: no debug APK produced." >&2; exit 1; }
fi

if ! docker ps -a --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "==> Starting container $NAME…"
  docker run -d --name "$NAME" --device /dev/kvm \
    -p 5555:5555 -v "$REPO":/project voltius-emulator
elif ! docker ps --format '{{.Names}}' | grep -qx "$NAME"; then
  echo "==> Restarting existing container $NAME…"
  docker start "$NAME"
fi

echo "==> Waiting for emulator boot (first cold boot ~1-2 min)…"
until docker exec "$NAME" sh -c 'adb shell getprop sys.boot_completed 2>/dev/null | tr -d "\r"' \
        | grep -qx 1; do
  sleep 3
done
echo "    emulator-5554 booted."

if [ -n "$APK" ]; then
  REL="/project/${APK#"$REPO"/}"
  echo "==> Installing $REL …"
  docker exec "$NAME" adb install -r "$REL"
  docker exec "$NAME" adb shell am start -n com.voltius.app/.MainActivity
fi

cat <<EOF

Emulator ready. Register the MCP (runs inside the container — local adb):

  claude mcp add tauri-android-emu --scope user \\
    --env PLATFORM=android --env ANDROID_SERIAL=emulator-5554 \\
    -- docker exec -i $NAME npx -y github:VoltiusApp/mcp-tauri-automation#android-backend

Restart Claude Code, then: launch_app → capture_screenshot → …
Logs: docker logs -f $NAME   |   logcat: docker exec $NAME adb logcat
EOF
