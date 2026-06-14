---
name: deploy-voltius-to-phone
description: Use when the user wants a working Voltius Android build installed on their own physical phone to test/poke at by hand (not MCP-driven automation) — builds the aarch64 debug APK and installs + launches it on the connected phone, then hands off for manual testing.
---

# Deploy Voltius to my phone (manual testing)

## Overview

Goal: get the **current code running on the user's real phone** so they can use it themselves.
This is the hand-off flow, not the automation flow — no MCP, no CDP. Just: build the APK, make
sure adb can see the phone, install + launch, tell the user it's ready.

For driving the app yourself via screenshots/clicks, use `iterating-on-voltius-android` instead.
For no-phone iteration, use `iterating-on-voltius-android-emulator`.

## 1. Build the APK (aarch64 — real phones are arm64)

```bash
scripts/android-build.sh aarch64
```
Output: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
(~310 MB, debug-signed with the committed `keystore/voltius-debug.keystore`, so `adb install -r`
upgrades in place without uninstalling). Build on the **x86_64 WSL2 laptop** — the NDK runs native
there; on an aarch64 host it runs under QEMU (~1h). Do NOT regenerate the keystore (breaks `-r` upgrades).

## 2. Make sure adb sees the phone (do this BEFORE installing)

Phone plugs into Windows; WSL reaches it through a Windows-hosted adb server. Set the socket
**inline on every Bash call** (each call is a fresh shell). Full setup + the three blockers
(Hyper-V firewall, adb version match, RSA auth prompt) are in the `android-adb-wsl-setup` memory.

```bash
export ADB_SERVER_SOCKET=tcp:192.168.240.1:5037
timeout 3 bash -c 'echo > /dev/tcp/192.168.240.1/5037' && echo OPEN || echo "DROPPED — firewall"
adb devices    # want: <serial>  device   (not "unauthorized" → tap "Allow" on phone; not empty → check cable/firewall)
```

## 3. Install + launch

```bash
ADB_SERVER_SOCKET=tcp:192.168.240.1:5037 \
  scripts/android-deploy.sh src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```
This runs `adb install -r` then `am start -n com.voltius.app/.MainActivity`. On success it prints the
WebView debug socket line — that confirms the app actually came up, not just installed.

## 4. Hand off

Tell the user it's installed and launched on their phone (app name **Voltius**), and that they can
reopen it from the launcher. If you changed something specific, tell them what to look for. If they
report a crash, you can pull it: `ADB_SERVER_SOCKET=… adb logcat -b crash -d` (Rust panics show under
`RustStdoutStderr`).

## Common mistakes

| Mistake | Fix |
|---|---|
| Building `x86_64` for a real phone | Real phones are arm64 — build `aarch64` |
| Forgetting `ADB_SERVER_SOCKET` | Set it inline every Bash call — fresh shell each time |
| `adb devices` shows `unauthorized` | Unlock phone, tap "Allow USB debugging" (RSA prompt) |
| `adb devices` hangs | Bounded `timeout 3 bash -c 'echo >/dev/tcp/<ip>/5037'` first; hang = Hyper-V firewall drop |
| Regenerating the debug keystore | Breaks `install -r` upgrades — it's committed, never regenerate |
| "It installed" = it works | Installed ≠ launched. Check the deploy script's WebView-socket line, or ask the user |
