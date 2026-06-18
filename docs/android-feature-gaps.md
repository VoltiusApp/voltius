# Android Feature-Compatibility Gaps — Triage Backlog

> **Uncommitted working doc** (do not commit). Each item is a self-contained task for a fresh
> session. Compiling for `aarch64-linux-android` only proves ABI linkage — these are the features
> whose *runtime* behavior the Android app sandbox (SELinux, no shell spawn, no raw devices, scoped
> storage) breaks or changes. Verify each on-device with the `PLATFORM=android` MCP, then fix.

Status legend: ⬜ not started · 🟡 in progress · ✅ done

Recommended order = by likelihood of blocking app startup, then by value.

---

## 1. ✅ OS keychain / secret storage  — DONE (branch `android-keychain`, commit d3e804a)
**Resolution:** Android keyring-core store backed by AndroidX EncryptedSharedPreferences
(hardware-backed MasterKey) — `VoltiusKeychain.kt` + `src-tauri/src/keychain_android.rs`,
registered in `init_keychain_store`. VM+Context captured via `nativeInit` from
`MainActivity.onCreate` (NOT `ndk_context` — tao 0.35 stopped populating it, which made
`ndk_context::android_context()` panic→SIGABRT across the JNI boundary). Plus graceful
degradation in `autoLogin`/splash. Verified on device: reaches first-launch UI, secret
set/get/delete round-trips.
> ⚠️ **Landmine:** `src-tauri/src/commands/vault.rs` ANDROID_ID (machine fingerprint /
> anti-abuse) still uses `ndk_context::android_context()` — will SIGABRT the same way when
> first hit on device. Needs the same Context-capture fix. File as its own task.
> ⚠️ MCP `execute_tauri_command` uses `window.__TAURI__` (global), absent in this app
> (no `withGlobalTauri`); use `window.__TAURI_INTERNALS__.invoke`. MCP fix candidate.

<details><summary>original</summary>

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

</details>

## 0. ✅ App-data storage path + splash hang — DONE (branch `android-storage-config-dir`, commit 29cda23)
**Discovered while verifying gap #2** (not in original list). `storage/config.rs::config_dir()`
used `dirs::config_dir()`, which on Android resolves to an **unwritable cwd ("/")** — so all generic
file storage (connections/identities/plugins/folders) wrote to a path that couldn't be created. Most
callers swallow this via `load_json`'s default, but `plugins_list_installed` propagates the error, and
`SplashScreen.finishLoading` awaited it **un-guarded** → the rejected invoke **froze the splash forever
on first launch** (this is why gap #1 only ever reached the *auth* screen, never the main UI — the vault
already used Tauri `app_data_dir()` so it was unaffected).
**Fix:** `CONFIG_DIR_OVERRIDE` (`OnceLock`) set once at startup; on Android, pin to
`app_data_dir()/voltius` (desktop unchanged). Plus `finishLoading` now wraps plugin loading in
try/catch so no startup invoke can freeze the splash again. Verified on device: first launch reaches the
main UI; `plugins_list_installed` returns `[]`.

## 2. ✅ Local terminal (PTY + shell spawn) — DONE (branch `android-gap2-local-terminal`, commit d7b9b4f)
**Resolution:** Backend already degrades cleanly on Android (`local_list_shells` → `[]`,
`local_connect` → errored promise, no crash/SIGABRT). The gap was pure UX: launchers still showed a
fallback "Local Machine"/"Local Shell" row even with no shells detected. Added a reusable platform
signal — `get_platform` Tauri command (`std::env::consts::OS`) + `src/utils/platform.ts`
(`useIsAndroid`) — and gated every local-shell launcher: NewSessionPopover, OmniSearch,
SessionPickerPanel, HostsToolbar (Terminal dropdown), HostPickerPanel (Local Machine + WSL). Verified
on device: home host-picker has no "Local Machine"; omni "local" → "No results"; `get_platform`="android".
> The `useIsAndroid()` / `get_platform` signal is the reusable lever for gaps #3–#5 below.
> ⚠️ Still local-shell-adjacent but **out of scope** (file separately): SidePane SFTP *local-filesystem*
> browsing still offers "Local Machine"; snippet **replay** of a recorded local target hits
> `beginLocalSession` (history path — fails gracefully, not a visible entry point).

<details><summary>original</summary>

## 2. ⬜ Local terminal (PTY + shell spawn)
- **Where:** `portable-pty` dep; `src-tauri/src/local/`, `shell_integration.rs`, terminal commands.
- **Problem:** Android sandbox blocks opening `/dev/ptmx` and exec'ing a login shell. (Termux works
  only inside its own prefix.)
- **Options:** (a) disable "local terminal" on Android (keep remote SSH terminal); (b) investigate a
  constrained exec inside app-private dir (limited, probably not worth it).
- **Acceptance (interim):** local-terminal entry hidden/disabled on Android; no crash.

</details>

## 3. ✅ Serial console — DONE (branch `android-gap3-serial`, commit 2428123)
**Resolution:** Backend degrades cleanly (`serial_list_ports` → `[]`, no crash). Gated the only
launcher — HostsToolbar "Serial" button — behind `useIsAndroid()`. Existing serial connections synced
from desktop stay visible but fail to connect gracefully. Verified on device: `serial_list_ports`→[],
serial button absent from the mounted Hosts toolbar.
> Stacks on gap #2 (needs `useIsAndroid`). Native USB-serial bridge (Android USB-host API) = future,
> out of scope.

<details><summary>original</summary>

## 3. ⬜ Serial console
- **Where:** `serialport` dep; `src-tauri/src/serial/`.
- **Problem:** no `/dev/tty*` access; Android serial needs the USB-host Java API + per-device
  runtime permission.
- **Options:** (a) disable on Android; (b) native USB-serial bridge via Android USB APIs (large).
- **Acceptance (interim):** serial feature disabled on Android; no crash.

</details>

## 4. ✅ Local Docker — DONE (branch `android-gap4-docker`, commit 7d14fb8)
**Resolution:** Docker here isn't socket-configured — it's a right-panel section scoped to the active
session: SSH session → `is_remote=true` (remote::, SSH exec, works on Android); local session →
`is_remote=false` (local::, exec local `docker` CLI, sandbox-blocked). Local Docker is already
**structurally unreachable** on Android: the panel needs an active session (RightPanel returns null
otherwise) and local sessions are gone (gap #2). Added a defensive guard anyway — DockerPanel shows a
"connect over SSH" notice and skips fetches when a non-SSH session backs it on Android, so a future
standalone launcher can't trip the local path.
> ⚠️ **Verification deferred:** compile-verified + structurally reasoned, but *remote* Docker not driven
> on-device — needs a Docker-enabled SSH host (rolls into gap #6). The DockerPanel can't even render on
> Android without an SSH session, so the guard itself is unreachable to drive here.

<details><summary>original</summary>

## 4. ⬜ Local Docker
- **Where:** `bollard`; `src-tauri/src/docker/`.
- **Problem:** no local Docker daemon/socket on a phone.
- **Options:** allow **remote** Docker only (TCP/SSH-tunneled `DOCKER_HOST`); hide local-socket path
  on Android.
- **Acceptance:** remote Docker connection works on device; local-socket option hidden.

</details>

## 5. ✅ Process list / system metrics — DONE (branch `android-gap5-metrics`, commit ef5615b)
**Resolution:** Same shape as Docker (#4). MetricsPanel + ProcessPanel are session-scoped right-panel
sections; SSH session → remote sysinfo on the host (works), local session → host sysinfo on the phone
(restricted `/proc`). Local path already unreachable (no local sessions). Added explicit guards: when a
non-SSH session backs either panel on Android, skip the stream start and show a "connect over SSH"
notice. (`TerminalStatusBar` mini-metrics already pass `isRemote=true` hardcoded.)
> ⚠️ Same verification note as #4 — compile-verified + structural; remote path needs an SSH host (#6).

<details><summary>original</summary>

## 5. ⬜ Process list / system metrics
- **Where:** `sysinfo`; `src-tauri/src/processes/`, `metrics/`.
- **Problem:** `/proc` restricted to the app's own process; system enumeration returns little.
- **Options:** restrict the feature to remote hosts on Android; or show "unavailable on Android".
- **Acceptance:** no crash; feature degrades gracefully.

</details>

## 6. ✅ Verify the network-client features actually work — VERIFIED on device (oracle SSH host)
- **Features:** SSH, SFTP, port-forward, Proxmox, remote Docker (SSH exec), remote metrics/processes.
- **Status (2026-06-13):** unblocked once cloud login worked (TLS fix 6a) — user synced an SSH host
  ("oracle", an Oracle-cloud Ubuntu box running Docker). All verified on-device against it. **No code
  fix needed for #6 itself** — every feature works on Android as-is over the russh transport; the only
  fix required was the TLS hang (6a, commit 2cdcac9).
- **Acceptance:** connect + basic op for each, on-device.

### Results (oracle = ubuntu@89.168.60.177, verified via live session + CDP backend invokes)
| Feature | Result | Evidence |
|---|---|---|
| SSH terminal | ✅ | Live shell, full MOTD, 18ms latency, keystroke I/O round-trips |
| SFTP list | ✅ | `sftp_open`+`sftp_list_dir /` → 23 entries; `/home` → [opc, ubuntu] |
| SFTP upload/download | ✅ | round-trip: downloaded `/etc/hostname` → phone cache (`instance-20260331-1910`), re-uploaded → visible in remote `/tmp` (23 B) |
| Remote Docker (SSH exec) | ✅ | `docker_list_containers(isRemote)` → **10 containers** (closes #4 remote-path debt) |
| Remote metrics | ✅ | live `metrics:snapshot` (cpu 2.36%, mem 2.5G/24.5G, net 59/64 KB/s) + status-bar mini-metrics (closes #5 debt) |
| Remote process list | ✅ | `processes_start(isRemote)` → **310 entries** (dockerd, containerd, cloudflared, sshd…) |
| Port-forward | ✅ (light) | UI shows "**6 active tunnels**" on the session — pf manager runs on Android over russh channels; not independently re-bound |
| **Proxmox** | ⏸ **deferred** | No Proxmox host on the phone — it lives in the unsynced legacy-key (`kek`) desktop blobs (see `sync-split-key-bug.md`). Proxmox uses the HTTPS reqwest client, so the TLS fix (6a) should cover it; **verify once the Proxmox host is on-device** (sync-bug fix, or add it manually). |

> Driving note: the `tauri-android` MCP CDP socket dropped repeatedly mid-session; the reliable path was
> a direct CDP harness (node 24 `WebSocket` → `adb forward tcp:9333 localabstract:webview_devtools_remote_<pid>`)
> calling backend commands via `__TAURI_INTERNALS__.invoke`. Stream commands (metrics/processes) deliver via
> Tauri events — capture with `__TAURI_INTERNALS__.transformCallback` + `plugin:event|listen`; payload is in
> the event envelope's `.payload` (`{ts, entries}` for processes). Scripts: `/tmp/cdpeval.mjs` (+ `/tmp/e_*.js`).

### 6a. ✅ TLS handshake hangs on Android (HTTPS infinite hang) — FIXED (branch `android`, commit 2cdcac9)
**Symptom:** cloud login spun forever; any HTTPS request (login, sync, Proxmox, updater) never returned.
**Root cause:** `reqwest`'s `["rustls"]` feature = **aws-lc-rs provider + rustls-platform-verifier**, and
the platform-verifier is **never initialised for Android** (no `rustls_platform_verifier::android::init_*`
call exists). Under that stack the TLS handshake never completes on Android. `connect_timeout` doesn't
cover the handshake and `appFetch` (src/services/http.ts) drops the JS `AbortController` signal it's
handed, so nothing bounded it → infinite-pending IPC promise → frozen `CloudAuthModal`.
**Proof (on-device, via direct CDP `__TAURI_INTERNALS__.invoke('http_request')`):** plain HTTP → 200 in
~65ms; HTTPS → hang (10 min observed, then capped). After fix: HTTPS → 404 in ~1s (correct server reply
for a bogus email), HTTP unchanged.
**Fix:** on Android only, hand reqwest a preconfigured rustls `ClientConfig` (ring provider + bundled
`webpki-roots`) via `use_preconfigured_tls` in `src-tauri/src/commands/http.rs::client_builder()`; desktop
keeps reqwest's default. `ring` was already in the tree (russh). Added a 30s overall `.timeout()` on
`http_request` as defence so a future stall errors instead of hanging.
> Never caught earlier because gaps #1–#5 only exercised **local-account** paths — no HTTPS ran on-device
> until the first cloud login attempt here.
> ⚠️ Likely also affects **Proxmox** (HTTPS API) — now expected to work; verify under #6.

---

## How to run the triage (fresh session)
1. Build + install: `scripts/android-build.sh` → `scripts/android-deploy.sh <apk>` (see
   `docs/android-dev.md`; on WSL set up `ADB_SERVER_SOCKET` first).
2. Register MCP `PLATFORM=android`, `launch_app`, then exercise each feature, `capture_screenshot`,
   and watch `adb logcat` for the Rust panics / errors.
3. Tackle items top-down; one branch + commit per gap.
