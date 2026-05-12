<div align="center">
  <img src="src-tauri/icons/128x128.png" alt="Voltius Logo" width="96" />
  
  <br/>

  <img src="./assets/demo.gif" alt="App Demo" width="100%" />

  <h1>Voltius</h1>

  <p><strong>A modern SSH client built with Tauri, React, and Rust.</strong></p>

  <p>
    <img src="https://img.shields.io/badge/status-beta-f59e0b" alt="Beta" />
    <img src="https://img.shields.io/badge/built_with-Rust-dea584?logo=rust" alt="Rust" />
    <img src="https://img.shields.io/badge/UI-Tauri-24c8db?logo=tauri" alt="Tauri" />
    <img src="https://img.shields.io/badge/Security-E2EE-green" alt="E2EE" />
    <img src="https://img.shields.io/github/license/Voltius/voltius" alt="License" />
  </p>
</div>

---

## ⚡ Why Voltius?

I built Voltius because I couldn't find an SSH client that checked every box. I wanted a tool that was blazingly fast and lightweight, featured a modern UI, and came complete with the features I actually use like Cloud E2EE Sync, SFTP host<->host w/ drag & drop...

Most existing tools are either stuck in the 90s, feel bloated, or lock essential features like device syncing behind expensive subscriptions. This project is my "no-compromise" solution: a native-speed, professional terminal that respects your data and your workflow.

## ✨ Features

### 🏠 Local-First Core (Free Forever)
No account required. Your data, your machine.
- **Plugin system:**
- **Gist Sync**: Decentralized state-based E2EE sync using private Gists. Each device maintains its own encrypted "blob" in your private Gist. Pulls are triggered via interval polling to keep your devices in sync without a central server.
- **SFTP:** Host/Local <-> Host/Local, supports drag & drop
- **Identity Management:** Manage your SSH keys and credentials and reuse them across connections.
- **Jump Hosts:** Define a chain of jump hosts to connect to hard-to-reach servers (SSH Tunneling).
- **SSH Config Import:** Import your existing `~/.ssh/config` and keep it in sync (read-only).
- **SSH Agent Forwarding:** Forward your SSH agent to use local keys on remote hosts.
- **Environment Variables:** Set environment variables for each connection.
- **Custom Commands:** Define pre-connection and post-connection commands.
- **Import/Export:** No vendor lock-in, Import/Export your vaults in a few clicks
- **Docker:** Manager Docker resources and open terminals directly in Voltius.
- **Serial Console:** Connect to serial devices directly from Voltius.
- **System Monitoring:** Live CPU, memory, and disk usage stats from connected hosts.
- **Local Terminal:** Start local terminals (Bash, Zsh, Fish, PowerShell, WSL, Git Bash, CMD, Cygwin, Cmder).
- **Split Panes:** Organize your workspace with horizontal and vertical splits and broadcast input to multiple panes simultaneously.
- **OS Detection:** Auto detect distros to show relevant icons and colors in the UI.
- **Process Manager:** View and manage running processes on connected hosts with a built-in process manager.
- **Port-Forwarding:** Automatic detection of open ports on connected hosts and one-click port forwarding.
- **Snippets**
- **Reachability checks:** Status badges and Latency indicators. Automatic ping checks with customizable intervals.
- **Encrypted Keychain:** Store encrypted keys/identities that you can reuse in hosts. Comes with useful features such as "Add to Host" to quickly add a public key to an host.
- **Command Palette (Cmd+K):** Search servers, switch teams, and trigger actions instantly.
- **Audit Logs:** Review recent vault activity.
- **Zero-Knowledge Sync:** Your data is encrypted locally before being synced. We can't read it, and neither can hackers.
- **Multi-Tab Support:** Native-speed tabs integrated into the window title bar.
- **Custom Themes:** Comes with built-in themes and you can make your own and share it !
- **Folders & Tags**
- **Cross-Platform:** Single-binary performance for macOS, Windows, and Linux.
- **Auto-Updates**
- **Status Badges:** Shows hosts status by using ping polling

### ⚡ Pro ($7/mo annual · $9/mo monthly — 14-day free trial, no card)
- **Real-Time Cloud Sync:** High-performance real-time engine using CRDTs for instant, conflict-free merging and SSE for sub-second updates across all devices.
- **Unlimited Private Vaults**
- **Terminal Sharing:** Share a terminal session ad-hoc with 1 guest — great for pair debugging or quick help.

### 👥 Teams ($15/user/mo annual · $18/user/mo monthly — 3-user minimum)
- **Team Vaults:** Shared vaults with easy member invites
- **Shared terminals (unlimited guests)**
- **Role-Based Access Control (RBAC):** Only default roles for teams plan, granular permissions and custom roles are reserved for Business plan to avoid complexity for small teams.
- **Team Audit Logs**

### 🏢 Business ($30/user/mo — contact us)
- **On-premise self-hosted backend**
- **Priority SLA support**
- **Granular permissions & Custom Roles**
- **Custom contracts**

## ⚖️ Comparison

| Feature | Voltius | Termius | [Reach](https://github.com/alexandrosnt/Reach) | [Termix](https://github.com/Termix-SSH/Termix) | Tabby | PuTTY |
| --- | --- | --- | --- | --- | --- | --- |
| **Engine** | **Rust + Tauri** 🦀 | Electron | **Rust + Tauri** 🦀 |  | Electron / Node.js | C |
| **RAM Usage** | ~300MB | ~500MB+ | ~300MB | NOT TESTED | NOT TESTED | **~5MB** |
| **Installed Size** | ~60MB | ~1GB | ~60MB | NOT TESTED | NOT TESTED | **~3MB** |
| **Cloud Sync** | Gist (Free) / Real-Time (Paid) | 🟡 Only Pro | 🟡 Complex setup | ❌ | Community Plugins | ❌ |
| **Import/Export** | ✅ |  | ✅ |  |  |  |
| **Port Forwarding** | ✅ | ✅ | ✅ |  |  |  |
| **Snippets** | ✅ + multi-exec | 🟡 Only Pro | ✅ + multi-exec |  |  |  |
| **Command Palette** | ✅ | ✅ |  |  |  |  |
| **Multi-tab** | ✅ | ✅ |  |  |  |  |
| **Team vaults** | ✅ Teams or self-hosted | ✅ Teams plan | ✅ Free but complex |  |  |  |
| **Audit logs** | ✅ | 🟡 Teams plan |  |  |  |  |
| **Custom Themes** | ✅ |  |  |  |  |  |
| **Folders &amp; Tags** | ✅ | ✅ | ✅ |  |  |  |
| **Auto-Updates** | ✅ | ✅ | ✅ |  |  |  |
| **Modern UI/UX** | ✅ | ✅ | 🟡 | ✅ | 🟡 | ❌ |
| **AI assistant** | ❌ | ✅ | ✅ |  |  |  |
| **Permissions** | ✅ Teams RBAC / Business custom roles | ✅ Granular perms |  |  |  |  |
| **Terminal sharing** | ✅ Pro (1 guest) / Teams (unlimited) | ✅ needs Teams plan |  |  |  |  |
| **Security** | **End-to-End Encrypted** | Proprietary E2EE | **End-to-End Encrypted** |  | Local Only / Manual |  |
| **SFTP host&lt;-&gt;host** | ✅ | ✅ | ❌ |  | ❌ | ❌ |
| **Serial Console** | ✅ | ✅ | ✅ |  |  |  |
| **Local-first** | ✅ 100% (No account needed) | ❌ (Requires account) | ✅ | ✅ | ✅ | ✅ |
| **Plugins** | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |
| **Platforms** | Windows, Linux, MacOS (Mobile coming soon) | Windows, Linux, MacOS, Android, IOS | Windows, Linux, MacOS, Android | All (web-based) | Windows, Linux, MacOS, we | Windows, ReactOS, macOS, Linux |
| **Pricing** | Free / Pro $7 / Teams $15 / Business $30 | Very limited free tier (no sync) | Free | Free | Free | Free |
| **License** | **AGPLv3 (Core)** | Commercial / Paid | MIT | Apache License Version 2.0 | MIT | MIT |
| **OS Detection** | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

## 🛡️ Architecture & Security
Voltius is built on a **Local-First, Zero-Knowledge** architecture. Your sensitive data (private keys, passwords, and server metadata) is encrypted on your machine before it ever touches a disk or a network.

### Account & Encryption Tiers
We offer three levels of security to fit your workflow:

- **OS Keychain (Local-Only)**: Uses your system's native secure storage (macOS Keychain, Windows Credential Manager, or Secret Service via keytar/libsecret). No master password required; maximum convenience for local-only use.

- **Master Password:** Encrypts your vault using a user-defined passphrase. Uses Argon2id for key derivation and AES-256-GCM for data encryption.

- **Cloud Account:** Enables seamless E2EE synchronization across devices via our high-speed relay service.

### Zero-Knowledge Synchronization
Whether you use our professional Cloud Sync or our built-in Gist Plugin, we follow a **Zero-Knowledge** protocol.

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

        KDF["Argon2id + HKDF-SHA256\n(32 MB mem · 2 iters)"]:::secure
        EncKey(("enc_key\n(AES-256-GCM key)")):::secure
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

    subgraph VaultLayer ["2. Local Vault (Rust · aes-gcm crate)"]
        AesGcm{"AES-256-GCM\n(Rust, via Tauri IPC)"}:::secure
        LocalStore[("secrets.enc\n(disk)")]:::local
        AesGcm <==>|"encrypt / decrypt"| LocalStore
    end

    EncKey -->|"enc_key passed over Tauri IPC"| AesGcm

    subgraph SyncLayer ["3. Zero-Knowledge Remote Sync"]
        direction LR

        subgraph GistSync ["Gist Sync (free · polling)"]
            direction TB
            GistKDF["derive_gist_key (Tauri cmd)\nArgon2id + HKDF-SHA256\npassphrase/PAT + manifest salt"]:::secure
            GistAes{"AES-256-GCM\n(Rust)"}:::secure
            Gist[("GitHub Gists\n(Bring-Your-Own)")]:::remote
            GistKDF -->|"gist_enc_key"| GistAes
            GistAes <==>|"Encrypted CRDT blobs"| Gist
        end

        subgraph CloudSync ["Cloud Sync (Pro/Teams · SSE)"]
            direction TB
            SseAes{"AES-256-GCM\n(Rust · encrypt_payload)"}:::secure
            SSE[("Voltius SSE Server")]:::remote
            SseAes <==>|"Encrypted CRDT payloads"| SSE
        end
    end

    EncKey -->|"enc_key"| SseAes

    Note1>All data leaving the device is strictly ciphertext.\nAuth Server, SSE Server, and GitHub have zero knowledge of vault contents.]:::note
    SyncLayer --- Note1
```

## Prerequisites

- [Node.js](https://nodejs.org/) 24+
- [pnpm](https://pnpm.io/) — `npm i -g pnpm`
- [Rust](https://rustup.rs/) (stable toolchain)
- Tauri prerequisites for your platform — see [tauri.app/start/prerequisites](https://tauri.app/start/prerequisites/)

## 🛠️ Development & Build

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

## 🛠️ Tech Stack

| Layer    | Tech                               |
|----------|------------------------------------|
| Frontend | React 19, TypeScript, Tailwind CSS |
| Backend  | Rust, Tauri 2, PostgreSQL (Sync)   |
| Terminal | xterm.js (WebGL Accelerated)       |
| SSH/SFTP | russh (Custom Rust implementation) |
| Security | Argon2id, AES-256-GCM (E2EE)       |

## 🗺️ Roadmap
-  [ ] Import Cloud (AWS, Azure, DigitalOcean) (Only for Pro plan, need to make sure it can't be bypassed by forking Tauri Client)
- [ ] Native Mobile App (via Tauri Mobile)

## 📄 Licensing
Voltius is licensed under the AGPLv3 for the core application and MIT for plugins. This means you can use and modify the core app for free, but if you distribute a modified version, you must also share your changes under the same license. Plugins can be used and shared with more flexibility under the MIT license.
Copyright © 2026 Killian Pavy. All rights reserved.
