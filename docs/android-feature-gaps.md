# Android Feature-Compatibility Gaps — Triage Backlog

> **Uncommitted working doc** (do not commit). Each item is a self-contained task for a fresh
> session. Compiling for `aarch64-linux-android` only proves ABI linkage — these are the features
> whose *runtime* behavior the Android app sandbox (SELinux, no shell spawn, no raw devices, scoped
> storage) breaks or changes. Verify each on-device with the `PLATFORM=android` MCP, then fix.

Status legend: ⬜ not started · 🟡 in progress · ✅ done

Recommended order = by likelihood of blocking app startup, then by value.

---

## 1. ⬜ OS keychain / secret storage  — EXPECTED FIRST BLOCKER
- **Where:** keyring stores in `src-tauri/Cargo.toml` (`windows-native-keyring-store`,
  `apple-native-keyring-store`, `linux-keyutils-keyring-store`), `keyring-core`; usage in
  `src-tauri/src/vault_auth.rs`, `src-tauri/src/commands/vault.rs`, `storage/`.
- **Problem:** no Android Keystore backend is wired. Secret read/write at startup will error or
  no-op; app may hang on splash (cf. desktop keyutils splash-hang, [[tauri-mcp-dev-container]]).
- **Options:** (a) implement an Android keystore-backed `keyring-core` store via the AndroidX
  `EncryptedSharedPreferences` / `KeyStore` (JNI, like the ANDROID_ID code in vault.rs); (b) interim:
  a file-based encrypted store in app-private scoped storage; (c) gate secrets off on Android with a
  clear UX until (a).
- **Acceptance:** app reaches main UI on device; create/read/delete a secret round-trips.

## 2. ⬜ Local terminal (PTY + shell spawn)
- **Where:** `portable-pty` dep; `src-tauri/src/local/`, `shell_integration.rs`, terminal commands.
- **Problem:** Android sandbox blocks opening `/dev/ptmx` and exec'ing a login shell. (Termux works
  only inside its own prefix.)
- **Options:** (a) disable "local terminal" on Android (keep remote SSH terminal); (b) investigate a
  constrained exec inside app-private dir (limited, probably not worth it).
- **Acceptance (interim):** local-terminal entry hidden/disabled on Android; no crash.

## 3. ⬜ Serial console
- **Where:** `serialport` dep; `src-tauri/src/serial/`.
- **Problem:** no `/dev/tty*` access; Android serial needs the USB-host Java API + per-device
  runtime permission.
- **Options:** (a) disable on Android; (b) native USB-serial bridge via Android USB APIs (large).
- **Acceptance (interim):** serial feature disabled on Android; no crash.

## 4. ⬜ Local Docker
- **Where:** `bollard`; `src-tauri/src/docker/`.
- **Problem:** no local Docker daemon/socket on a phone.
- **Options:** allow **remote** Docker only (TCP/SSH-tunneled `DOCKER_HOST`); hide local-socket path
  on Android.
- **Acceptance:** remote Docker connection works on device; local-socket option hidden.

## 5. ⬜ Process list / system metrics
- **Where:** `sysinfo`; `src-tauri/src/processes/`, `metrics/`.
- **Problem:** `/proc` restricted to the app's own process; system enumeration returns little.
- **Options:** restrict the feature to remote hosts on Android; or show "unavailable on Android".
- **Acceptance:** no crash; feature degrades gracefully.

## 6. ⬜ Verify the network-client features actually work
- **Features:** SSH, SFTP, port-forward, Proxmox, remote Docker-over-TCP. Expected to work (pure
  sockets/HTTPS) but **unverified on device**.
- **Acceptance:** connect + basic op for each, on-device, via the MCP.

---

## How to run the triage (fresh session)
1. Build + install: `scripts/android-build.sh` → `scripts/android-deploy.sh <apk>` (see
   `docs/android-dev.md`; on WSL set up `ADB_SERVER_SOCKET` first).
2. Register MCP `PLATFORM=android`, `launch_app`, then exercise each feature, `capture_screenshot`,
   and watch `adb logcat` for the Rust panics / errors.
3. Tackle items top-down; one branch + commit per gap.
