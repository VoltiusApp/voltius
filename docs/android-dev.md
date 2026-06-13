# Voltius Android Dev Workflow

How to build the Android app, run it on a real phone, and drive its WebView from
Claude Code through the `mcp-tauri-automation` MCP (adb + Chrome DevTools Protocol backend).

> Design + plan: `docs/superpowers/specs/2026-06-12-android-dev-environment-design.md`,
> `docs/superpowers/plans/2026-06-12-android-dev-environment.md`.

## TL;DR

```
# build (server or laptop) — produces a debug-signed APK
scripts/android-build.sh            # aarch64 (phone); pass "all" for every arch

# install + launch on a USB phone (laptop)
scripts/android-deploy.sh <apk-path>

# drive it from Claude Code (laptop), MCP in android mode
PLATFORM=android  → launch_app / capture_screenshot / click_element / type_text / ...
```

## 1. Build the APK

`scripts/android-build.sh [ARCH]` builds inside the `voltius-android` Docker image
(`Dockerfile.android`). Default `ARCH=aarch64` (real phones). `all` builds every arch.

- Output: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`
- It is a **debug** build: large (~310 MB — the unstripped Rust `.so`), debug-signed with the
  committed dev keystore `keystore/voltius-debug.keystore` (so `adb install -r` upgrades in place).
- **Build host — prefer the x86_64 box.** The Android NDK has **no Linux-arm64 toolchain** (host
  builds ship only for Linux x86_64, Windows x86_64, macOS), so on an aarch64 host (the server, an
  ARM laptop) the NDK's x86_64 clang runs under QEMU and builds are emulation-slow (~1h clean).
  **Build on the x86_64 WSL2 laptop instead** — same `Dockerfile.android` / `scripts/android-build.sh`,
  no changes (the QEMU/amd64 lines become harmless no-ops on x86_64), NDK runs native → much faster.
  adb is unchanged on either WSL laptop: the phone plugs into Windows, so still use the
  Windows-hosted adb server / usbipd (see §2). The aarch64 server/ARM laptop still build fine if
  needed, just slowly.

## 2. Reach the phone from WSL

WSL2 cannot see a USB phone natively. Pick one:

1. **(recommended) Windows-hosted adb server.** Install Android platform-tools on Windows, plug the
   phone into Windows, and on Windows run:
   ```
   adb -a -P 5037 nodaemon server
   ```
   Then in WSL:
   ```
   export ADB_SERVER_SOCKET=tcp:<windows-host-ip>:5037
   adb devices        # should list the phone
   ```
   `<windows-host-ip>` is usually the WSL gateway (`ip route show | awk '/default/{print $3}'`) or
   the Windows LAN IP. Every `adb` call — scripts *and* the MCP — then proxies to the phone with no
   code change.
2. **usbipd-win.** `usbipd attach --wsl --busid <id>` to pass the USB device into WSL; native Linux
   `adb` then sees it directly. Re-attach on each replug.

Prereqs on the phone: Developer Options → USB debugging ON (authorize the RSA prompt).

## 3. Install + launch

```
scripts/android-deploy.sh <apk-path>
# = adb install -r <apk> ; adb shell am start -n com.voltius.app/.MainActivity
```
Then confirm the WebView exposes its CDP socket:
```
adb shell grep -a webview_devtools_remote /proc/net/unix     # -> @webview_devtools_remote_<pid>
```
(Only present because this is a `--debug` build; Tauri enables WebView debugging there.)

## 4. Drive it from Claude Code

Register the MCP in android mode (from `../mcp-tauri-automation`, after `npm run build`):
```
claude mcp add tauri-android --env PLATFORM=android \
  --env ADB_SERVER_SOCKET=tcp:<windows-host-ip>:5037 \
  -- node "$PWD/dist/index.js"
```
(Drop the `ADB_SERVER_SOCKET` line if you used usbipd / native adb.)

Optional env: `ANDROID_APP_ID` (default `com.voltius.app`), `ANDROID_MAIN_ACTIVITY`
(default `.MainActivity`), `ANDROID_SERIAL`, `ANDROID_FORWARD_PORT` (default 9222),
`ANDROID_ADB_PATH`.

Then the SAME tools as desktop work against the phone:
- `launch_app` (appPath ignored) → starts the activity, finds the WebView socket, `adb forward`s it,
  attaches CDP. `get_app_state` should show `isRunning: true`.
- `capture_screenshot` → full native frame via `adb exec-out screencap`.
- `click_element` / `type_text` / `press_key` / `wait_for_element` / `get_element_text` → CDP + adb.
- `execute_tauri_command` → `window.__TAURI__.core.invoke(...)`.

Native dialogs (permission prompts, the system file picker) are outside the WebView; drive them with
`adb shell input tap/keyevent` at observed coordinates.

## 5. Feature-compatibility triage (DO THIS FIRST on device)

A successful cross-compile only proves the code links for the Android ABI — **not** that features
work at runtime. The Android app sandbox (SELinux, no arbitrary process spawn, no raw devices, scoped
storage) breaks several host-integration features. Walk this list once the app is on the phone:

| Feature | Expectation on Android | Action |
|---|---|---|
| OS keychain / secret storage | ❌ No Android Keystore backend wired yet | **Likely first blocker** — may hang/error at startup (cf. desktop keyutils splash-hang). Implement an Android keystore backend or stub gracefully. |
| Local terminal (PTY/shell) | ❌ Sandbox blocks `/dev/ptmx` + shell spawn | Redesign or disable on Android. |
| Serial console | ❌ No `/dev/tty*`; needs USB-host API | Native rewrite or disable. |
| Local Docker | ⚠️ No local daemon | Allow remote (TCP/SSH) only. |
| Process list / metrics | ⚠️ `/proc` restricted to own process | Expect mostly non-functional. |
| SSH / SFTP / port-forward / Proxmox / remote Docker | ✅ Network clients | Expect to work; verify. |

Use the MCP to launch each feature, screenshot, and record what throws. File one issue per gap.

## Notes / gotchas
- `src-tauri/gen/android` (the Gradle project) and `keystore/voltius-debug.keystore` are committed for
  reproducibility. Never regenerate the keystore, or installed builds fail to upgrade (uninstall first).
- `machine-uid` is excluded from mobile builds (no Android backend); the machine fingerprint comes from
  `Settings.Secure.ANDROID_ID` via JNI (`src-tauri/src/commands/vault.rs`).
- Install size only matters for the one-time `adb install` over USB; runtime footprint is normal. A
  `--release` build (or a dev `strip="debuginfo"` profile) shrinks the `.so` dramatically if needed.
