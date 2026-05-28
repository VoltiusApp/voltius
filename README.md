<div align="center">
  <img src="src-tauri/icons/128x128.png" alt="Voltius Logo" width="96" />
  
  <br/>

  <img src="./assets/demo.gif" alt="App Demo" width="100%" />

  <h1>Voltius</h1>

  <p><strong>A local-first SSH/SFTP/Serial client with E2EE sync, plugins, and no account required — a modern alternative to Termius.</strong></p>

  <p>
    <img src="https://img.shields.io/badge/status-beta-f59e0b" alt="Beta" />
    <img src="https://img.shields.io/badge/built_with-Rust-dea584?logo=rust" alt="Rust" />
    <img src="https://img.shields.io/badge/UI-Tauri-24c8db?logo=tauri" alt="Tauri" />
    <img src="https://img.shields.io/badge/Security-E2EE-green" alt="E2EE" />
    <img src="https://img.shields.io/github/license/Voltius/voltius" alt="License" />
  </p>
</div>

---

## ✨ Features

No account required. Everything below is free, forever.

- **Easy Import & Export** — No vendor lock-in. Import your existing setup from Termius (1-click), MobaXterm, SecureCRT, and more. Your data is always exportable as open JSON.
- **Gist Sync** — E2EE device sync via your own private GitHub Gist. No central server, bring your own token.
- **SFTP** — Easy file transfers and browsing, works for Host↔Host and Host↔Local with drag & drop support.
- **Split Panes** — Horizontal/vertical splits with broadcast input to multiple panes.
- **Local Terminal** — Bash, Zsh, Fish, PowerShell, WSL, Git Bash, CMD, and more.
- **Plugin System** — Install plugins from the [official registry](https://github.com/VoltiusApp/marketplace) or point to your own custom repo.
- **Container Management** — Docker and Proxmox LXC. Browse containers, open terminals, and manage resources without leaving Voltius.
- **Process Manager** — View and kill processes on connected hosts.
- **System Monitoring** — Live CPU, memory, and disk stats from connected hosts.

> Full feature list at [docs.voltius.app](https://docs.voltius.app) *(coming soon)* · **Pro · Teams · Business** — see [voltius.app/#pricing](https://voltius.app/#pricing) for paid plans.

## ⚖️ Comparison

| Feature | Voltius | Termius | [Reach](https://github.com/alexandrosnt/Reach) | [Termix](https://github.com/Termix-SSH/Termix) | Tabby |
| --- | --- | --- | --- | --- | --- |
| **Engine** | **Rust + Tauri** 🦀 | Flutter + Dart (likely; closed-source) | **Rust + Tauri** 🦀 | Web (React + Node.js) | Electron / Node.js |
| **RAM Usage** | ~300MB | ~500MB+ | ~300MB | NOT TESTED | NOT TESTED |
| **Installed Size** | ~60MB | ~1GB | ~60MB | NOT TESTED | NOT TESTED |
| **Cloud Sync** | Gist (Free) / Real-Time (Paid) | 🟡 Only Pro | 🟡 Via Turso (own account) | ❌ | Community Plugins |
| **Import/Export** | 🚧 WIP: Only JSON Import/Export for now | 🟡 Strong Import Integrations but no Export | ✅ |  |  |
| **Port Forwarding** | ✅ | ✅ | ✅ |  | ✅ |
| **Snippets** | ✅ + multi-exec | 🟡 (Multi-exec + startup snippets only Pro) | ✅ + multi-exec |  |  |
| **Command Palette** | ✅ | ✅ |  |  | ✅ |
| **Split panes** | ✅ | ✅ | ❌ |  |  |
| **X11 Forwarding** | ❌ | | ❌ |  |  |
| **Docker Integration** | ✅ |  |  |  |  |
| **Proxmox LXC Integration** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **System Monitoring** | ✅ |  |  |  |  |
| **Jump Hosts** | ✅ | ✅ | ✅ |  |  |
| **Team vaults** | ✅ Teams or self-hosted | ✅ Teams plan | ✅ Free but complex |  |  |
| **Audit logs** | ✅ | 🟡 Teams plan |  |  |  |
| **Custom Themes** | ✅ |  |  |  | ✅ |
| **Folders &amp; Tags** | ✅ | ✅ | ✅ |  |  |
| **Auto-Updates** | ✅ | ✅ | ✅ |  |  |
| **Modern UI/UX** | ✅ | ✅ | 🟡 | ✅ | 🟡 |
| **AI assistant** | ❌ | ✅ | ✅ |  |  |
| **Permissions** | ✅ Teams RBAC / Business custom roles | ✅ Granular perms |  |  |  |
| **Terminal sharing** | ✅ Pro (1 guest) / Teams (unlimited) | ✅ needs Teams plan |  |  |  |
| **Security** | **End-to-End Encrypted** | Proprietary E2EE | **End-to-End Encrypted** |  | Local Only / Manual |
| **SFTP host&lt;-&gt;host** | ✅ | ✅ | ❌ |  | ❌ |
| **Serial Console** | ✅ | ✅ | ✅ |  | ✅ |
| **Local-first** | ✅ 100% (No account needed) | ❌ (Requires account) | ✅ | ✅ | ✅ |
| **Plugins** | ✅ | ❌ | ✅ | ❌ | ✅ |
| **Platforms** | Windows, Linux, MacOS (Mobile coming soon) | Windows, Linux, MacOS, Android, IOS | Windows, Linux, MacOS, Android | All (web-based) | Windows, Linux, MacOS, Web |
| **License** | **AGPLv3** | Commercial / Paid | MIT | Apache License Version 2.0 | MIT |
| **OS Detection** | ✅ | ✅ | ✅ | ❌ | ❌ |

## 🛡️ Architecture & Security
Voltius is built on a **Local-First, Zero-Knowledge** architecture. Your sensitive data (private keys, passwords, and server metadata) is encrypted on your machine before it ever touches a disk or a network.

### Account & Encryption Tiers
We offer three levels of security to fit your workflow:

- **OS Keychain (Local-Only)**: Uses your system's native secure storage (macOS Keychain, Windows Credential Manager, or Secret Service via keytar/libsecret). No master password required; maximum convenience for local-only use.

- **Master Password:** Encrypts your vault using a user-defined passphrase. Uses Argon2id for key derivation and XChaCha20-Poly1305 for data encryption.

- **Cloud Account:** Enables seamless E2EE synchronization across devices via our high-speed relay service.

### Web Portal

Account registration and login at [app.voltius.app](https://app.voltius.app) are also fully E2EE. The same `voltius-crypto` crate is compiled to WebAssembly and runs entirely in your browser — key derivation (Argon2id + HKDF-SHA256) happens client-side before anything touches the network. The server only ever receives an `auth_key`, never your password or encryption key.

### Zero-Knowledge Synchronization
Whether you use our professional Cloud Sync or our built-in Gist Plugin, we follow a **Zero-Knowledge** protocol. All data leaving the device is strictly ciphertext — the auth server, SSE server, and GitHub have zero knowledge of vault contents.

<details>
<summary>Sync architecture diagram</summary>

```mermaid
flowchart TD
    classDef cleartext fill:#ffebee,stroke:#c62828,stroke-width:2px,color:#000;
    classDef secure fill:#e8f5e9,stroke:#2e7d32,stroke-width:2px,color:#000;
    classDef local fill:#fff3e0,stroke:#e65100,stroke-width:2px,color:#000;
    classDef remote fill:#e3f2fd,stroke:#1565c0,stroke-width:2px,color:#000;
    classDef wasm fill:#f3e5f5,stroke:#6a1b9a,stroke-width:2px,color:#000;
    classDef note fill:#f9f9f9,stroke:#666,stroke-width:1px,stroke-dasharray: 5 5,color:#333;

    subgraph RegLayer ["0. Account Creation (one-time)"]
        direction LR

        subgraph PortalReg ["Web Portal — app.voltius.app"]
            PortalCreds["Email + Password"]:::cleartext
            WasmKDF["voltius-crypto-wasm\n(Argon2id + HKDF-SHA256\nsame crate · WASM target)"]:::wasm
            AuthKeyPortal(("auth_key")):::secure
            PortalCreds -->|"password + generated account_id"| WasmKDF
            WasmKDF -->|"enc_key discarded\n(no vault in portal)"| WasmKDF
            WasmKDF --> AuthKeyPortal
        end

        subgraph DesktopReg ["Desktop Client (Tauri)"]
            DesktopCreds["Email + Password"]:::cleartext
            NativeKDF["voltius-crypto · native Rust\n(Argon2id + HKDF-SHA256)"]:::secure
            AuthKeyDesktop(("auth_key")):::secure
            DesktopCreds -->|"password + generated account_id"| NativeKDF
            NativeKDF -->|"enc_key → vault unlock\n(proceeds to step 1)"| NativeKDF
            NativeKDF --> AuthKeyDesktop
        end

        RegServer[("Auth Server")]:::remote
        AuthKeyPortal -->|"email + auth_key + account_id"| RegServer
        AuthKeyDesktop -->|"email + auth_key + account_id\n+ public_key + machine_fingerprint"| RegServer
        RegServer -->|"JWT + account_id"| PortalCreds
        RegServer -->|"JWT + account_id"| DesktopCreds
    end

    subgraph AuthLayer ["1. Vault Unlock (Tauri Desktop — voltius-crypto · native Rust)"]
        direction TB
        subgraph Methods ["Vault Unlock Methods"]
            direction LR
            OS["OS Keychain"]:::local
            MP["Master Password"]:::local
            Cloud["Cloud Account\n(Email & Password)"]:::remote
        end

        KDF["Argon2id + HKDF-SHA256\n(128 MB mem · 3 iters · p=4)"]:::secure
        EncKey(("enc_key\n(XChaCha20-Poly1305 key)")):::secure
        AuthKey(("auth_key\n→ server login")):::secure

        Cloud -->|"password + account_id"| KDF
        MP -->|"password + account_id"| KDF
        OS -->|"retrieves enc_key directly\n(stored after prior login)"| EncKey
        KDF --> EncKey
        KDF --> AuthKey
        AuthKey -->|"POST /v1/auth/login"| AuthServer[("Auth Server")]:::remote
        AuthServer -->|"JWT"| Cloud
    end

    RegLayer -.->|"account created — use same\ncredentials in desktop Cloud Account"| Cloud

    subgraph VaultLayer ["2. Local Vault (Rust · chacha20poly1305 crate)"]
        XChaCha{"XChaCha20-Poly1305\n(Rust, via Tauri IPC)"}:::secure
        LocalStore[("secrets.enc\n(disk)")]:::local
        XChaCha <==>|"encrypt / decrypt"| LocalStore
    end

    EncKey -->|"enc_key passed over Tauri IPC"| XChaCha

    subgraph SyncLayer ["3. Zero-Knowledge Remote Sync"]
        direction LR

        subgraph GistSync ["Gist Sync (free · polling)"]
            direction TB
            GistKDF["derive_gist_key (Tauri cmd)\nArgon2id + HKDF-SHA256\npassphrase/PAT + manifest salt"]:::secure
            GistAead{"XChaCha20-Poly1305\n(Rust)"}:::secure
            Gist[("GitHub Gists\n(Bring-Your-Own)")]:::remote
            GistKDF -->|"gist_enc_key"| GistAead
            GistAead <==>|"Encrypted app-state blobs"| Gist
        end

        subgraph CloudSync ["Cloud Sync (Pro/Teams · SSE)"]
            direction TB
            SseAead{"XChaCha20-Poly1305\n(Rust · encrypt_payload)"}:::secure
            SSE[("Voltius SSE Server")]:::remote
            SseAead <==>|"Encrypted CRDT payloads"| SSE
        end
    end

    EncKey -->|"enc_key"| SseAead

    Note1>All data leaving the device is strictly ciphertext.\nAuth Server, SSE Server, and GitHub have zero knowledge of vault contents.]:::note
    SyncLayer --- Note1
```

</details>

## Prerequisites

- [Node.js](https://nodejs.org/) 24+
- [pnpm](https://pnpm.io/) — `npm i -g pnpm`
- [Rust](https://rustup.rs/) (stable toolchain)
- Tauri prerequisites for your platform — see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

## 🛠️ Development & Build

Early beta — PRs and issues are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) to get started.

For dev, you simply need to run:
```bash
pnpm i
pnpm tauri dev
```

### Building in Docker (recommended)

I've made a Dockerfile that allows cross-compilation to Windows ARM64/x64; Linux ARM64/x64 without needing to set up a complex toolchain on your machine:

```bash
# Build the cross-compilation image
docker build -f Dockerfile.cross-compile -t voltius-cross .

# Run the build inside the container
docker run --rm -it \
  -v "$(pwd):/project" \
  voltius-cross \
  bash -c 'pnpm tauri build --target aarch64-pc-windows-msvc --runner cargo-xwin --no-bundle'
```

The `--no-bundle` flag skips NSIS installer creation (not supported in cross-compilation). The built executable is at:
```
src-tauri/target/aarch64-pc-windows-msvc/release/voltius.exe
```

You can replace `aarch64-pc-windows-msvc` with the appropriate target. Here's a quick reference for targets:
- Windows x64: `x86_64-pc-windows-msvc`
- Windows ARM64: `aarch64-pc-windows-msvc`
- Linux x64: `x86_64-unknown-linux-gnu`
- Linux ARM64: `aarch64-unknown-linux-gnu`

If you want to build for other target, see `rustup target list` and add with `rustup target add <target>`. I have not tested other targets.

> Note: build will work but throw an error except if you set TAURI_SIGNING_PRIVATE_KEY and TAURI_SIGNING_KEY_PASSWORD to dummy values, which is required by the Tauri build process even if you don't do code signing in cross-compilation. You can set them to any non-empty value to bypass the error.

### 🐧WSL2 dev note

```sh
sudo apt install -y build-essential libssl-dev pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev
LIBGL_ALWAYS_SOFTWARE=1 && pnpm tauri dev
```

### Build

```bash
pnpm tauri build
```

Output installers are placed in `src-tauri/target/release/bundle/`.

## 🧰 Tech Stack

| Layer       | Tech                               |
|-------------|------------------------------------|
| Frontend    | React 19, TypeScript, Tailwind CSS |
| Desktop     | Rust, Tauri 2                      |
| Sync Server | Rust, Axum, PostgreSQL             |
| Terminal    | xterm.js (WebGL Accelerated)       |
| SSH/SFTP    | russh                              |
| Security    | Argon2id, HKDF-SHA256, XChaCha20-Poly1305 (E2EE) |

## 📄 Licensing
Voltius is licensed under the AGPLv3 for the core application and MIT for plugins. This means you can use and modify the core app for free, but if you distribute a modified version, you must also share your changes under the same license. Plugins can be used and shared with more flexibility under the MIT license.
Copyright © 2026 Killian Pavy. All rights reserved.
