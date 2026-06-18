---
name: iterating-on-voltius-android-emulator
description: Use when building, deploying, running, screenshotting, clicking through, or debugging the Voltius Tauri app on a headless Android emulator running in Docker (no physical phone) — drives the in-container x86_64 emulator through the tauri-android MCP (adb + Chrome DevTools Protocol) so changes are seen and interacted with, not just compiled.
---

# Iterating on Voltius Android (Docker emulator)

## Overview

No phone, no cable. A headless **x86_64 Android emulator runs in Docker** (`Dockerfile.android-emulator`),
and the `tauri-android` MCP runs **inside the same container** via `docker exec`, so adb is local —
none of the real-phone Windows-firewall / `ADB_SERVER_SOCKET` pain applies. Same MCP, same tool names,
same selector rules as the on-device flow (`iterating-on-voltius-android`); only the transport differs.

Use this for fast no-device iteration / CI. Use the real-phone skill when a feature depends on actual
hardware (real keychain, USB serial, camera) — the emulator's sandbox still differs from a real device,
so **a cross-compile or an emulator pass is not proof a feature works on real hardware**. The proof is
still: drive it, read the screenshot, check logcat.

Requires `/dev/kvm` (KVM accel — verified on x86_64 WSL2). The MCP itself needs **no changes**: it is
device-agnostic (`ANDROID_SERIAL` selects the target, adb is local, CDP host defaults to `127.0.0.1`).

**Arch:** the Dockerfile and the orchestrator both pick the ABI from the build host's `uname -m` —
**x86_64 host → x86_64 image + x86_64 APK; ARM host → arm64-v8a image + aarch64 APK.** KVM only
accelerates a same-arch guest, so the ABI must match the host. On **ARM-WSL2** two things are unverified
(check on that box): `ls /dev/kvm` must exist (Windows-on-ARM nested-virt exposure is less mature), and
`sdkmanager "emulator"` must pull a working linux-aarch64 emulator host binary.

## Bring it up (one command)

```bash
scripts/android-emulator.sh          # build image → build matching-arch APK → run → wait boot → install + launch
scripts/android-emulator.sh --no-apk # just boot the emulator (install the APK yourself later)
```
First run downloads the SDK + system image and bakes the AVD into the image (slow once, cached after).
Cold boot ~1-2 min. The script auto-builds the APK for the host arch — don't hardcode it.

Manual equivalents (also documented at the bottom of `Dockerfile.android-emulator`):

```bash
docker build -f Dockerfile.android-emulator -t voltius-emulator .
docker run -d --name android-emulator --device /dev/kvm -p 5555:5555 -v "$(pwd):/project" voltius-emulator
docker logs -f android-emulator     # wait for "boot completed"
scripts/android-build.sh x86_64   # match the host: x86_64 on Intel/AMD, aarch64 on ARM → "universal" APK
docker exec android-emulator adb install -r \
  /project/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
docker exec android-emulator adb shell am start -n com.voltius.app/.MainActivity
```

## Register the MCP

```bash
claude mcp add tauri-android-emu --scope user \
  --env PLATFORM=android --env ANDROID_SERIAL=emulator-5554 \
  -- docker exec -i android-emulator npx -y "github:VoltiusApp/mcp-tauri-automation#android-backend"
```
No `ADB_SERVER_SOCKET` and no `ANDROID_CDP_HOST` — adb and CDP are local to the container.
**Mid-session gotcha:** a freshly-added MCP's tools are NOT callable until the session reloads
(tool registry is fixed at startup). Restart Claude Code or `/reload-plugins`, then the
`mcp__tauri-android-emu__*` tools appear. `claude mcp list` shows connected ≠ tools loaded.

## Drive loop

1. `launch_app` (appPath ignored) → starts the activity, finds the WebView socket, `adb forward`s it,
   attaches CDP. Confirm `get_app_state` → `isRunning: true`.
2. `click_element` / `type_text` / `press_key` / `wait_for_element` / `get_element_text` —
   CSS selectors only (no `:contains`/XPath); grep the component, don't guess.
3. `capture_screenshot` → full frame via `adb exec-out screencap` → **Read the file and look**.
   Blank/old frame = launch failed. Save shots under `./screenshots/` (gitignored), e.g.
   `docker exec android-emulator sh -c 'adb exec-out screencap -p' > screenshots/NN-what.png` —
   keep them out of the repo root so they never get committed.
4. `execute_tauri_command` → probe a backend command via `window.__TAURI__` invoke.

**Native dialogs** (permission prompts, system file picker) are OUTSIDE the WebView — CDP can't touch
them. Drive with `docker exec android-emulator adb shell input tap <x> <y>` / `… input keyevent <KEY>`
at coordinates read from a screenshot.

## Root-causing on the emulator

```bash
docker exec android-emulator adb logcat -d -t 200 | grep -iE 'voltius|RustStdoutStderr|panic|FATAL'
```
A startup panic with no WebView socket = a host-integration feature failed early. Reproduce → logcat →
fix → re-deploy (`scripts/android-build.sh x86_64` + `adb install -r`) → re-drive.

## Common mistakes

| Mistake | Fix |
|---|---|
| ABI mismatch (x86_64 APK on ARM guest, or vice-versa) | APK arch must match the host/image arch — let `android-emulator.sh` pick it, or `android-build.sh x86_64`/`aarch64` to match |
| Running without `--device /dev/kvm` | Emulator won't accelerate / boots fail — KVM is required |
| Driving a native dialog via CDP | Native UI is outside the WebView — `adb shell input tap/keyevent` |
| MCP "connected" but tools missing | Tool registry fixed at startup — restart / `/reload-plugins` after adding the MCP |
| "It ran on the emulator" = works on a phone | Emulator sandbox ≠ real device — confirm hardware-dependent features on the phone |
| Re-running `docker run` after it exists | Use `scripts/android-emulator.sh` (it `docker start`s an existing container) or `docker start android-emulator` |
