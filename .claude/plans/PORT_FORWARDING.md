# Port Forwarding — Architecture Plan

> Feature **core** — non pluggable by design.  
> Requires direct access to SSH sessions (russh `direct-tcpip` channels).

---

## Table of Contents

1. [Overview & Two-Layer Model](#1-overview--two-layer-model)
2. [Layer 1 — Persistent Rules (Storage)](#2-layer-1--persistent-rules-storage)
3. [Layer 2 — Active Tunnels (Runtime)](#3-layer-2--active-tunnels-runtime)
4. [Port Detection (Auto Mode)](#4-port-detection-auto-mode)
5. [Tunnel Creation & Bridge](#5-tunnel-creation--bridge)
6. [Lifecycle & Cleanup](#6-lifecycle--cleanup)
7. [Tauri Commands & Events](#7-tauri-commands--events)
8. [UI — Port Forwarding Page](#8-ui--port-forwarding-page)
9. [UI — PortsPanel (Terminal RightPanel)](#9-ui--portspanel-terminal-rightpanel)
10. [Edge Cases](#10-edge-cases)
11. [Files to Create / Modify](#11-files-to-create--modify)
12. [Roadmap](#12-roadmap)

---

## 1. Overview & Two-Layer Model

Port forwarding has **two distinct concerns** that must not be conflated:

| Layer | What | Where | Persists? |
|-------|------|-------|-----------|
| **Rules** | Saved configurations (`local:3000 → remote:3000`) | Port Forwarding Page, vault-aware, card UI | Yes — `port_forwarding_rules.json` |
| **Active Tunnels** | Runtime SSH tunnels for a live session | PortsPanel in terminal RightPanel | No — lost on disconnect |

Rules are first-class objects like connections, snippets, SSH keys:
- belong to a vault
- can be organized in folders
- show as cards with context menus
- support cloud sync toggle, drag-and-drop, multi-select

Active tunnels are ephemeral runtime state managed by `PortForwardManager`.  
The PortsPanel links the two: it lets the user activate saved rules in the current session, and also create ad-hoc (unsaved) tunnels.

```
Port Forwarding Page (NavItem: "port-forwarding")
  └── RuleCard × N  ← saved configs, vault-aware, always visible
        └── "Activate in session" → creates an active tunnel

Terminal → RightPanel → "Ports" tab
  └── Active tunnels for this session
        ├── From saved rules (shows rule name)
        └── Ad-hoc (no backing rule)
```

---

## 2. Layer 1 — Persistent Rules (Storage)

### Rust struct (follows Connection / Snippet / SshKey pattern)

```rust
// src-tauri/src/storage/config.rs — append

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortForwardingRule {
    pub id: String,
    pub name: String,
    pub local_port: u16,
    pub remote_port: u16,
    #[serde(default = "default_localhost")]
    pub remote_host: String,  // "127.0.0.1" for local; can be a hostname for jump-host scenarios
    #[serde(default)]
    pub description: Option<String>,
    /// Which SSH connections this rule applies to (empty = all)
    #[serde(default)]
    pub connection_ids: Vec<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default = "default_personal")]
    pub vault_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
    pub clocks: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub struct PortForwardingRuleFormData {
    pub name: String,
    pub local_port: u16,
    pub remote_port: u16,
    #[serde(default = "default_localhost")]
    pub remote_host: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub connection_ids: Vec<String>,
    #[serde(default)]
    pub folder_id: Option<String>,
    #[serde(default)]
    pub vault_id: Option<String>,
}

fn default_localhost() -> String { "127.0.0.1".to_string() }
```

### Storage (follows connections.json / snippets.json pattern)

```rust
// src-tauri/src/storage/config.rs

fn port_forwarding_rules_file() -> PathBuf {
    config_dir().join("port_forwarding_rules.json")
}

pub fn load_port_forwarding_rules() -> Vec<PortForwardingRule> { ... }
pub fn save_port_forwarding_rules(rules: &[PortForwardingRule]) -> Result<(), String> { ... }
```

### Folders

Rules use the **existing** `Folder` struct with `object_type = "port-forwarding-rule"`.  
No new folder type needed — the folder CRUD commands already support arbitrary `object_type`.

### CRUD Tauri commands

```rust
// src-tauri/src/commands/port_forwarding_rules.rs

#[tauri::command] pf_rule_list() -> Result<Vec<PortForwardingRule>, String>
#[tauri::command] pf_rule_create(data: PortForwardingRuleFormData) -> Result<PortForwardingRule, String>
#[tauri::command] pf_rule_update(id: String, data: PortForwardingRuleFormData) -> Result<PortForwardingRule, String>
#[tauri::command] pf_rule_delete(id: String) -> Result<(), String>          // soft-delete + clocks
#[tauri::command] pf_rule_duplicate(id: String) -> Result<PortForwardingRule, String>
#[tauri::command] pf_rule_move_folder(id: String, folder_id: Option<String>) -> Result<(), String>
```

---

## 3. Layer 2 — Active Tunnels (Runtime)

### Why a separate `PortForwardManager`

`SessionManager` stores `HashMap<String, ConnectedSession>` directly (no `SessionEntry` wrapper).  
Adding tunnel state there would couple unrelated concerns.

**Solution**: a standalone `PortForwardManager` as a separate Tauri managed state.

```rust
// src-tauri/src/port_forward/mod.rs

pub struct PortForwardManager {
    sessions: Arc<Mutex<HashMap<String, SessionPfState>>>,
    app: AppHandle,
}

struct SessionPfState {
    tunnels: Vec<ActiveTunnel>,
    auto_detect: bool,
    poller_cancel: Option<CancellationToken>,
}

pub struct ActiveTunnel {
    pub id: String,              // uuid — for frontend reference
    pub local_port: u16,
    pub remote_port: u16,
    pub remote_host: String,
    pub origin: TunnelOrigin,
    pub state: TunnelState,
    _cancel: CancellationToken,  // drop => cancels all bridges for this tunnel
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TunnelOrigin {
    Auto,
    AdHoc,
    Rule { rule_id: String, rule_name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TunnelState { Active, Error(String) }

#[derive(Debug, thiserror::Error)]
pub enum ForwardError {
    #[error("Port {0} already in use after {1} attempts")]
    PortInUse(u16, u8),
    #[error("Session not found: {0}")]
    SessionNotFound(String),
    #[error("SSH channel error: {0}")]
    Channel(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}
```

### Tauri state registration

```rust
// lib.rs
.manage(PortForwardManager::new(app_handle.clone()))
```

---

## 4. Port Detection (Auto Mode)

### Detection strategy (priority order)

Each poll opens a new exec channel on the existing SSH session — no extra connection.  
Same pattern as `detect_distro` in `session.rs:43-89`.

```rust
const DETECTION_COMMANDS: &[&str] = &[
    "ss -tlnp 2>/dev/null",
    "netstat -tlnp 2>/dev/null",
    "cat /proc/net/tcp /proc/net/tcp6 2>/dev/null",
];
```

If none succeed → manual mode only, no blocking error.

### Exec pattern (mirrors `detect_distro`)

```rust
async fn poll_ports(handle: Arc<client::Handle<SshClient>>) -> Result<Vec<u16>, String> {
    for cmd in DETECTION_COMMANDS {
        let channel = handle.channel_open_session().await?;
        channel.exec(true, cmd).await?;

        let mut stream = channel.into_stream();
        let mut output = Vec::new();
        let ok = timeout(Duration::from_secs(5), async {
            let mut buf = [0u8; 65536];
            loop {
                match stream.read(&mut buf).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => output.extend_from_slice(&buf[..n]),
                }
            }
        }).await.is_ok();

        if !ok || output.is_empty() { continue; }

        if let Some(ports) = try_parse(cmd, &String::from_utf8_lossy(&output)) {
            return Ok(ports);
        }
    }
    Ok(vec![])
}
```

### Parsing `/proc/net/tcp` and `/proc/net/tcp6`

```rust
fn parse_proc_net_tcp(output: &str) -> Vec<u16> {
    output.lines().skip(1).filter_map(|line| {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.get(3)? != &"0A" { return None; }  // 0A = LISTEN
        let (addr_hex, port_hex) = cols.get(1)?.split_once(':')?;
        // IPv4 loopback 127.0.0.1 → 0100007F (little-endian)
        // IPv6 loopback ::1      → 00000000000000000000000001000000
        if addr_hex != "0100007F" && addr_hex != "00000000000000000000000001000000" {
            return None;
        }
        u16::from_str_radix(port_hex, 16).ok()
    }).collect()
}
```

### Parsing `ss -tlnp`

```rust
fn parse_ss(output: &str) -> Vec<u16> {
    // Output format varies across util-linux versions.
    // Strategy: find a column containing loopback address, parse port after last ':'
    output.lines().skip(1).filter_map(|line| {
        line.split_whitespace().find_map(|col| {
            if col.starts_with("127.0.0.1:") || col.starts_with("[::1]:") {
                col.rsplit_once(':').and_then(|(_, p)| p.parse::<u16>().ok())
            } else { None }
        })
    }).collect()
}
```

### Default ignored ports

```rust
const IGNORED_PORTS: &[u16] = &[
    22,    // SSH itself
    25,    // SMTP
    110,   // POP3
    143,   // IMAP
    445,   // SMB
    3306,  // MySQL  — auto-ignored; available manually
    5432,  // PostgreSQL — same
];
```

### Poll interval

```rust
const POLL_INTERVAL: Duration = Duration::from_secs(2);
```

---

## 5. Tunnel Creation & Bridge

### Port conflict retry

Default `local_port = remote_port`. Retry `port+1` up to 5 times, then error.

```rust
pub async fn create_tunnel(
    handle: Arc<client::Handle<SshClient>>,
    local_port: u16,
    remote_port: u16,
    remote_host: &str,
    cancel: CancellationToken,
) -> Result<u16, ForwardError> {
    let mut listener = None;
    let mut bound_port = local_port;
    for offset in 0..5u16 {
        let try_port = local_port.saturating_add(offset);
        if let Ok(l) = TcpListener::bind(format!("127.0.0.1:{try_port}")).await {
            bound_port = try_port;
            listener = Some(l);
            break;
        }
    }
    let listener = listener.ok_or(ForwardError::PortInUse(local_port, 5))?;

    let remote_host = remote_host.to_string();
    let cancel2 = cancel.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = cancel2.cancelled() => break,
                result = listener.accept() => {
                    let Ok((tcp_stream, _)) = result else { break };
                    tokio::spawn(bridge(
                        Arc::clone(&handle), tcp_stream,
                        remote_host.clone(), remote_port, bound_port,
                        cancel2.clone(),
                    ));
                }
            }
        }
    });

    Ok(bound_port)
}
```

### Bridge pattern

russh channels are NOT `AsyncRead`/`AsyncWrite` — `copy_bidirectional` won't work.  
Use `channel.split()` + `make_writer()`, same as `client.rs:288`.

```rust
async fn bridge(
    handle: Arc<client::Handle<SshClient>>,
    tcp: TcpStream,
    remote_host: String,
    remote_port: u16,
    local_port: u16,
    cancel: CancellationToken,
) {
    let ch = match handle.channel_open_direct_tcpip(
        &remote_host, remote_port as u32, "127.0.0.1", local_port as u32,
    ).await { Ok(c) => c, Err(_) => return };

    let (mut ch_read, ch_write) = ch.split();
    let mut ch_writer = ch_write.make_writer();
    let (mut tcp_r, mut tcp_w) = tokio::io::split(tcp);

    let c1 = cancel.clone();
    let tcp_to_ssh = tokio::spawn(async move {
        tokio::select! {
            _ = c1.cancelled() => {}
            _ = tokio::io::copy(&mut tcp_r, &mut ch_writer) => {}
        }
    });

    let c2 = cancel.clone();
    let ssh_to_tcp = tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = c2.cancelled() => break,
                msg = ch_read.wait() => match msg {
                    Some(ChannelMsg::Data { data }) => {
                        if tcp_w.write_all(&data).await.is_err() { break; }
                    }
                    Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => break,
                    _ => {}
                }
            }
        }
    });

    let _ = tokio::join!(tcp_to_ssh, ssh_to_tcp);
}
```

---

## 6. Lifecycle & Cleanup

### Session disconnect

Called from `commands/ssh.rs::ssh_disconnect`, right after `session_manager.disconnect()`:

```rust
pf_manager.on_session_disconnect(&session_id).await;
```

```rust
pub async fn on_session_disconnect(&self, session_id: &str) {
    let mut sessions = self.sessions.lock().await;
    if let Some(state) = sessions.remove(session_id) {
        if let Some(cancel) = state.poller_cancel { cancel.cancel(); }
        // ActiveTunnel._cancel dropped here → all bridges stop
    }
    let _ = self.app.emit("pf-state-changed", PfStatePayload {
        session_id: session_id.to_string(),
        tunnels: vec![],
    });
}
```

### Tunnel teardown when remote port disappears (Phase 2)

Keep tunnel open until connections drain naturally. Only remove from the UI list. Cancel only on explicit user removal or session disconnect.

---

## 7. Tauri Commands & Events

### Layer 1 — Rules CRUD

```rust
// src-tauri/src/commands/port_forwarding_rules.rs
pf_rule_list()
pf_rule_create(data: PortForwardingRuleFormData)
pf_rule_update(id, data)
pf_rule_delete(id)
pf_rule_duplicate(id)
pf_rule_move_folder(id, folder_id)
```

### Layer 2 — Active Tunnel management

```rust
// src-tauri/src/commands/port_forwarding_tunnels.rs
pf_tunnel_list(session_id)                       // list active tunnels for session
pf_tunnel_open(session_id, local_port, remote_port, remote_host?, rule_id?)  // ad-hoc or from rule
pf_tunnel_close(session_id, tunnel_id)
pf_tunnel_set_auto(session_id, enabled)          // Phase 2
```

### Events (kebab-case, consistent)

```rust
// Emitted by PortPoller on each state change
app.emit("pf-state-changed",   PfStatePayload      { session_id, tunnels: Vec<ActiveTunnel> });

// Phase 2 — auto-detection events
app.emit("pf-port-detected",   PfPortDetectedPayload { session_id, port, suggested_local_port });
app.emit("pf-port-closed",     PfPortClosedPayload   { session_id, port });
```

---

## 8. UI — Port Forwarding Page

### Navigation

`NavItem` already includes `"port-forwarding"` in `uiStore.ts:7`. Wire up in `MainPanel.tsx`:

```typescript
// src/components/layout/MainPanel.tsx — mirror the keychain overlay pattern (line 98)
if (activeNav === "port-forwarding") {
  overlayContent = <PortForwardingPage />;
}
```

### Page structure

Mirrors `KeychainPage.tsx`. Full layout via `SidePanelLayout`:

```
PortForwardingPage
  ├── PortForwardingToolbar  (search, sort, layout toggle, "+ New Rule")
  ├── Folder section         (existing Folder cards, object_type="port-forwarding-rule")
  └── Rules section          (RuleCard × N)
```

### uiStore additions

```typescript
// src/stores/uiStore.ts — mirror keychain fields
portForwardingLayoutMode: LayoutMode;   // default: "list"
portForwardingSortMode: SortMode;       // default: "newest"
portForwardingPendingAction: PortForwardingPendingAction;  // for "open form" flows
```

### `RuleCard.tsx`

Uses `BaseCard`, `CardActionButton`, `vaultMenuItems`, `useUIContributions` — **same patterns as `HostCard.tsx`**.

```typescript
// src/components/port_forwarding/RuleCard.tsx

const contextMenuItems: ContextMenuItem[] = [
  ...(canEdit ? [{ label: "Edit",      icon: "lucide:pencil", onClick: () => onEdit(rule) }] : []),
  { label: "Activate in session", icon: "lucide:plug-zap",  onClick: () => onActivate(rule) },
  ...(canEdit ? [{ label: "Duplicate", icon: "lucide:copy",   onClick: () => onDuplicate(rule.id) }] : []),
  ...contributions.map((a, i) => ({ ...a, divider: i === 0 })),
  ...vaultMenuItems(vaults, canEdit, onMoveTo, onCopyTo),
  {
    label: isSynced ? "Disable cloud sync" : "Enable cloud sync",
    icon:  isSynced ? "lucide:cloud-off"   : "lucide:cloud",
    onClick: () => useSyncPrefsStore.getState().toggleExcluded(rule.id),
    divider: true,
  },
  ...(canEdit ? [{ label: "Delete", icon: "lucide:trash-2", onClick: () => onDelete(rule.id), danger: true }] : []),
];
```

**Card content** (list mode):
```
[icon: lucide:network]  name          local:PORT → remote:HOST:PORT   [edit] [delete]
                        description?  connection tags (if scoped)
```

**Active indicator**: if a tunnel is live for this rule in the current session, show a green dot (like `isActive` in `BaseCard`).

### `RuleForm.tsx` / `RuleModal.tsx`

Fields:
- Name (required)
- Local port (required, validated 1–65535)
- Remote host (default: `127.0.0.1`)
- Remote port (required)
- Description (optional)
- Scope: "All connections" or pick specific connections
- Vault (dropdown)

### `PortForwardingToolbar.tsx`

- Search input
- Sort: newest / oldest / name
- Layout: grid / list
- "+ New Rule" button → opens `RuleModal`

---

## 9. UI — PortsPanel (Terminal RightPanel)

### RightPanelSection type update

```typescript
// src/stores/uiStore.ts — line 9
export type RightPanelSection = "snippets" | "history" | "themes" | "ports";
```

### RightPanel.tsx changes

```typescript
// SECTIONS array
{ id: "ports", icon: "lucide:network", title: "Ports" },

// section renderer
case "ports": return <PortsPanel />;
```

### `PortsPanel.tsx`

Gets `activeSessionId` from `useSessionStore()` — same pattern as `SnippetsPanel.tsx:444`.  
Only meaningful when `activeSession.type === "ssh"`.

Two sub-sections:

**Active tunnels** — shows current live tunnels with:
- origin badge: `Auto` | `Ad-hoc` | rule name
- `local:PORT → remote:HOST:PORT`
- close button (calls `pf_tunnel_close`)

**Quick activate** — shows saved rules that are NOT yet active in this session.  
Click → `pf_tunnel_open(sessionId, rule.localPort, rule.remotePort, rule.remoteHost, rule.id)`.

```typescript
export function PortsPanel() {
  const { activeSessionId } = useSessionStore();
  const [tunnels, setTunnels] = useState<ActiveTunnel[]>([]);
  const [rules, setRules] = useState<PortForwardingRule[]>([]);

  useEffect(() => {
    if (!activeSessionId) { setTunnels([]); return; }
    invoke<ActiveTunnel[]>("pf_tunnel_list", { sessionId: activeSessionId }).then(setTunnels);
    invoke<PortForwardingRule[]>("pf_rule_list").then(setRules);

    const unlisten = listen<PfStatePayload>("pf-state-changed", ({ payload }) => {
      if (payload.session_id === activeSessionId) setTunnels(payload.tunnels);
    });
    return () => { unlisten.then(f => f()); };
  }, [activeSessionId]);

  const activeRuleIds = new Set(tunnels.flatMap(t =>
    t.origin.type === "rule" ? [t.origin.rule_id] : []
  ));
  const inactiveRules = rules.filter(r => !activeRuleIds.has(r.id));
  // ...
}
```

### Auto-detect toast notification (Phase 2)

Global listener in `App.tsx` (or dedicated hook):

```
↗  Port 3000 forwarded  →  localhost:3000   [Open in browser]  [×]
```

---

## 10. Edge Cases

| Situation | Behavior |
|-----------|----------|
| Non-Linux host (no `/proc/net/tcp`, no `ss`) | Manual mode only, no error |
| Local port already in use | Try `port+1` up to 5 times, then notify user |
| Session disconnected | Cancel poller + all tunnel bridges, emit `pf-state-changed []` |
| Port on ignored list (DB, SMTP...) | Silent in auto mode, available manually |
| Host binds on `0.0.0.0` | Ignored in auto (already public), available manually |
| Remote port disappears mid-tunnel | Keep tunnel open to drain; remove from UI; don't force-cancel |
| `ss` output format variation | Fallback chain: `ss` → `netstat` → `/proc/net/tcp` |
| `activeSessionId` is a local session | PortsPanel shows "Port forwarding requires an SSH session" |
| User closes tunnel with active connections | Cancel immediately (TCP gets RST) — documented in UI tooltip |
| Rule scoped to specific connections | "Activate in session" only shown when current connection matches |
| `pf_tunnel_open` called with `rule_id` | `TunnelOrigin::Rule { rule_id, rule_name }` — shown in panel |
| Rule deleted while tunnel is active | Tunnel stays alive; origin becomes `AdHoc` (or keep stale rule name) |
| Permission denied (vault EDIT check) | Edit/Delete hidden in context menu; canEdit = false |

---

## 11. Files to Create / Modify

### New files

```
src-tauri/src/port_forward/
  mod.rs                      ← PortForwardManager, SessionPfState, ActiveTunnel, ForwardError
  tunnel.rs                   ← create_tunnel(), bridge()
  poller.rs                   ← PortPoller, poll_ports(), parse_proc_net_tcp(), parse_ss()

src-tauri/src/commands/
  port_forwarding_rules.rs    ← pf_rule_* CRUD commands
  port_forwarding_tunnels.rs  ← pf_tunnel_* runtime commands

src/components/port_forwarding/
  PortForwardingPage.tsx      ← full page (mirrors KeychainPage.tsx)
  PortForwardingToolbar.tsx   ← search, sort, layout toggle, "+ New Rule"
  RuleCard.tsx                ← BaseCard + context menu + vault items
  RuleForm.tsx                ← form fields (used in modal + inline edit)
  RuleModal.tsx               ← modal wrapper around RuleForm

src/components/terminal/
  PortsPanel.tsx              ← active tunnels + quick activate
```

### Modified files

```
src-tauri/src/storage/config.rs
  └── + PortForwardingRule, PortForwardingRuleFormData structs
  └── + load/save_port_forwarding_rules()

src-tauri/src/lib.rs
  └── + .manage(PortForwardManager::new(app_handle.clone()))
  └── + register all pf_rule_* and pf_tunnel_* commands

src-tauri/src/commands/mod.rs
  └── + pub mod port_forwarding_rules;
  └── + pub mod port_forwarding_tunnels;

src-tauri/src/commands/ssh.rs  (ssh_disconnect)
  └── + pf_manager.on_session_disconnect(&session_id).await;

src-tauri/Cargo.toml
  └── + tokio-util = { version = "0.7", features = ["rt"] }   ← CancellationToken

src/stores/uiStore.ts
  └── NavItem already has "port-forwarding" ✓ (line 7)
  └── + "ports" to RightPanelSection union (line 9)
  └── + portForwardingLayoutMode, portForwardingSortMode, portForwardingPendingAction fields

src/components/layout/MainPanel.tsx
  └── + if (activeNav === "port-forwarding") overlayContent = <PortForwardingPage />;

src/components/terminal/RightPanel.tsx
  └── + { id: "ports", icon: "lucide:network", title: "Ports" } to SECTIONS
  └── + case "ports": return <PortsPanel />;
```

---

## 12. Roadmap

### Phase 1 — Persistent Rules + Manual Tunnels ✅

**Backend**
- [x] `PortForwardingRule` struct + storage in `config.rs`
- [x] `commands/port_forwarding_rules.rs` — full CRUD
- [x] `port_forward/mod.rs` — `PortForwardManager`, `ActiveTunnel`, `ForwardError`
- [x] `port_forward/tunnel.rs` — `create_tunnel()`, `bridge()`
- [x] `commands/port_forwarding_tunnels.rs` — `pf_tunnel_list`, `pf_tunnel_open`, `pf_tunnel_close`
- [x] Register all commands + state in `lib.rs`
- [x] Hook `on_session_disconnect` in `commands/ssh.rs`
- [x] `tokio-util` dependency in `Cargo.toml` (already present)

**Frontend**
- [x] `uiStore.ts` — add `"ports"` to `RightPanelSection`, add layout/sort/pendingAction fields
- [x] `MainPanel.tsx` — wire `"port-forwarding"` nav to `PortForwardingPage`
- [x] `PortForwardingPage.tsx` — scaffold with toolbar + rule sections
- [x] `PortForwardingToolbar.tsx`
- [x] `RuleCard.tsx` — BaseCard + full context menu + vault items
- [x] `RuleForm.tsx` (modal-less inline panel, no separate RuleModal needed)
- [x] `RightPanel.tsx` — add "Ports" section entry
- [x] `PortsPanel.tsx` — active tunnels list + quick activate from rules

### Phase 2 — Auto-Detection ✅

- [x] `port_forward/poller.rs` — 3-strategy detection, all parsers
- [x] `pf_tunnel_set_auto` + `pf_tunnel_get_auto` commands
- [x] `pf-port-detected` / `pf-port-closed` events
- [x] Auto-detect toggle in `PortsPanel.tsx`
- [x] Global toast for detected ports (`PfToastContainer` in `App.tsx`)

### Phase 3 — Ergonomics ✅

- [x] "Open in browser" on detected HTTP ports (toast + PortsPanel globe button)
- [x] Auto-activate matching rules when a session connects (`connection_ids` scope)
- [x] Traffic indicator on active tunnels (bytes transferred, shown in PortsPanel)
- [x] Re-create tunnels on reconnect after network loss (covered by auto-activate on connect)
- [x] Global rules — scope picker in RuleForm; scoped badge in RuleCard
