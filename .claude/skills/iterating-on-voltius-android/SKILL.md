---
name: iterating-on-voltius-android
description: Use when building, deploying, running, screenshotting, clicking through, or debugging the Voltius Tauri app on a real Android phone — drives the on-device debug APK through the tauri-android MCP (adb + Chrome DevTools Protocol) so changes are seen and interacted with on the device, not just compiled.
---

# Iterating on Voltius Android

## Overview

Build the debug APK, install it on the phone, then **look at it and drive it on the device**
through the `tauri-android` MCP (adb + CDP). Same tool names as the desktop `tauri-docker`
backend, selected by `PLATFORM=android`. A cross-compile only proves ABI linkage — the Android
sandbox (SELinux, no shell spawn, no raw devices, scoped storage) breaks several host-integration
features at *runtime*; the only proof a feature works is driving it on the phone and reading the
screenshot. See `docs/android-dev.md` (runbook) and `docs/android-feature-gaps.md` (triage queue).

## Build (x86_64 WSL2 laptop — build here)

```bash
scripts/android-build.sh aarch64   # Docker (Dockerfile.android); native NDK on x86_64, no QEMU
```
Output: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
(~310 MB, debug-signed with committed `keystore/voltius-debug.keystore` → `adb install -r` upgrades).
On an aarch64 host the NDK runs under QEMU (~1h clean) — avoid; build on the x86_64 box.

## Reach the phone + deploy (do this FIRST — MCP is useless if adb can't see the phone)

Phone plugs into Windows; WSL reaches it via a Windows-hosted adb server. Full setup +
the three non-obvious blockers (Hyper-V firewall, adb version match, RSA auth) live in the
**`android-adb-wsl-setup`** memory. Quick check before anything else:

```bash
export ADB_SERVER_SOCKET=tcp:192.168.240.1:5037   # set inline EVERY Bash call (fresh shell each time)
timeout 3 bash -c 'echo > /dev/tcp/192.168.240.1/5037' && echo OPEN || echo "DROPPED — firewall"
adb devices                                        # want: <serial>  device  (not unauthorized/empty)
scripts/android-deploy.sh <apk>                    # install -r + am start com.voltius.app/.MainActivity
adb shell grep -a webview_devtools_remote /proc/net/unix   # want @webview_devtools_remote_<pid> = app up
```

## Register the MCP (android mode)

```bash
claude mcp add tauri-android --scope user \
  --env PLATFORM=android --env ADB_SERVER_SOCKET=tcp:192.168.240.1:5037 \
  -- npx -y "github:VoltiusApp/mcp-tauri-automation#android-backend"
```
**Mid-session gotcha:** a freshly-added MCP's tools are NOT callable until the session reloads
(tool registry is fixed at startup). Restart Claude Code, or `/reload-plugins`, then the
`mcp__tauri-android__*` tools appear. `claude mcp list` shows connected ≠ tools loaded.

## Drive loop

1. `launch_app` (appPath ignored) → starts activity, finds WebView socket, `adb forward`s it,
   attaches CDP. Confirm `get_app_state` → `isRunning: true`.
2. `click_element` / `type_text` / `press_key` / `wait_for_element` / `get_element_text` —
   CSS selectors only (no `:contains`/XPath); grep the component, don't guess. Same selector
   rules as `iterating-on-voltius-ui`.
3. `capture_screenshot` → full native frame via `adb exec-out screencap` → **Read the file and
   look**. Blank/old frame = launch failed.
4. `execute_tauri_command` → `window.__TAURI__.core.invoke(...)` to probe a backend command.

**Native dialogs** (permission prompts, system file picker) are OUTSIDE the WebView — CDP can't
touch them. Drive with `adb shell input tap <x> <y>` / `adb shell input keyevent <KEY>` at
coordinates read from a screenshot.

## Root-causing a feature on device

Watch the Rust side while you drive: `adb logcat -d -t 200 | grep -iE 'voltius|RustStdoutStderr|panic|FATAL'`.
A panic at startup with no WebView socket = a host-integration feature failed early (keychain,
PTY, serial). Reproduce → logcat → root-cause → fix → re-deploy → re-drive. One branch + commit
per feature gap (`docs/android-feature-gaps.md`).

## Common mistakes

| Mistake | Fix |
|---|---|
| Forgetting `ADB_SERVER_SOCKET` in a Bash call | Each call is a fresh shell — `export` it inline every time |
| `adb devices` hangs forever | Don't poll it raw; bounded `timeout 3 bash -c 'echo >/dev/tcp/<ip>/5037'` first; hang = firewall drop |
| MCP "connected" but tools missing | Tool registry fixed at startup — restart / `/reload-plugins` after adding the MCP |
| Driving a native dialog via CDP | Native UI is outside the WebView — `adb shell input tap/keyevent` |
| "It compiled / installed" = works | Cross-compile ≠ runtime; sandbox breaks host features. Drive it, read the screenshot, check logcat |
| Building on the aarch64 box | NDK runs under QEMU there (~1h) — build on the x86_64 WSL laptop |
| Regenerating the dev keystore | Breaks `install -r` upgrades — keystore is committed, never regenerate |
