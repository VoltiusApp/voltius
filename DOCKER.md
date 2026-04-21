# Docker Plugin — Plan

## Overview

Bundled plugin at `src/plugins/docker/`. Adds a **Docker** tab to the RightPanel.
Shows containers/images/volumes/networks for the **active session's host** (local or remote SSH).

---

## Architecture

### Data flow

```
RightPanel (Docker tab)
  └── DockerPanel (React)
        └── invoke("docker_*") ──► Rust commands
                                      ├── Local: connect to /var/run/docker.sock (reqwest + unix socket)
                                      └── Remote: open side SSH channel on active session → exec docker CLI / REST over SSH tunnel
```

### Remote strategy

Open a **dedicated SSH exec channel** (separate from the terminal pty) on the active `russh` session.
Run `docker` CLI commands via that channel. No terminal pollution.
- `docker ps --format json` → container list
- `docker inspect`, `docker start/stop/restart/rm`, etc.
- Logs: `docker logs --follow --tail 200 <id>` streamed as Tauri events

Alternative (later): tunnel `/var/run/docker.sock` over SSH port-forward for full REST API parity.
Start with CLI approach — simpler, works on all remotes without extra dependencies.

---

## Rust Backend

### New crate deps (Cargo.toml)

```toml
bollard = { version = "0.17", features = ["ssl"] }   # Docker REST client (local)
reqwest = { version = "0.12", features = ["json"] }   # already may exist
```

For remote: reuse existing `russh` session infrastructure (open exec channel on stored session handle).

### Commands

| Command | Args | Returns |
|---|---|---|
| `docker_list_containers` | `session_id?: string, all: bool` | `Vec<DockerContainer>` |
| `docker_list_images` | `session_id?` | `Vec<DockerImage>` |
| `docker_list_volumes` | `session_id?` | `Vec<DockerVolume>` |
| `docker_list_networks` | `session_id?` | `Vec<DockerNetwork>` |
| `docker_container_action` | `session_id?, container_id, action: start\|stop\|restart\|remove\|pause\|unpause` | `()` |
| `docker_start_log_stream` | `session_id?, container_id, tail: u32` | `stream_id: string` (emits `docker:log:<stream_id>` events) |
| `docker_stop_log_stream` | `stream_id` | `()` |

### Event format

```
docker:log:<stream_id>  →  { line: string, stream: "stdout"|"stderr", ts: number }
```

---

## Plugin (TypeScript)

### Manifest

```ts
{
  id: "plugin-docker",
  permissions: ["sessions:read", "notifications"],
  defaultEnabled: true,
}
```

### Registration

```ts
api.ui.registerRightPanelSection({
  id: "docker",
  label: "Docker",
  icon: "mdi:docker",
  component: DockerPanel,
});
```

---

## UI Components

### Panel layout (300px wide)

```
┌─────────────────────────────┐
│ [C] [I] [V] [N]   ○ local  │  ← tab bar + host badge
├─────────────────────────────┤
│ ● nginx          running    │
│   restart  stop  logs  rm   │
│ ○ postgres       exited     │
│   start          logs  rm   │
│ ...                         │
└─────────────────────────────┘
```

**Tabs**: Containers (C) · Images (I) · Volumes (V) · Networks (N)

**Container row**:
- Status dot (green=running, gray=stopped, yellow=paused)
- Name + image tag (truncated)
- Action buttons: start/stop/restart · logs · remove
- Expand chevron → shows port mappings, mounts, env count

**Logs view** (in-panel, same pattern as ThemesSection "creating" state):
- Back arrow → returns to container list
- Scrollable log lines with ANSI color support
- Auto-scroll toggle
- "Open in terminal tab" button → opens new pty tab running `docker logs -f`

### Images tab

Compact list: name:tag · size · age · `pull` / `remove` actions

### Volumes & Networks tabs

Simple list: name · driver · `remove` action

---

## State management

No new Zustand store. Component-local state with `useReducer`:

```ts
type DockerState = {
  view: "containers" | "images" | "volumes" | "networks" | "logs";
  containers: DockerContainer[];
  logsContainerId: string | null;
  logLines: LogLine[];
  loading: boolean;
  error: string | null;
};
```

Auto-refresh: poll every 5s (containers change infrequently). Logs use event stream.

---

## File structure

```
src/plugins/docker/
  index.ts              ← manifest + register fn
  types.ts              ← DockerContainer, DockerImage, etc.
  components/
    DockerPanel.tsx     ← root, tab routing, state
    ContainerList.tsx
    ContainerRow.tsx
    ImageList.tsx
    VolumeList.tsx
    NetworkList.tsx
    LogsView.tsx        ← log stream + ANSI renderer

src-tauri/src/docker/
  mod.rs
  local.rs             ← bollard client (unix socket)
  remote.rs            ← russh exec channel commands
  commands.rs          ← #[tauri::command] handlers
  stream.rs            ← log streaming + event emitter
```

---

## Constraints & edge cases

- **Docker not installed**: commands return `DockerNotFound` error → panel shows install prompt
- **Remote without docker**: same error path
- **Permission denied on socket**: surface clear message (add user to docker group)
- **Session switch**: panel resets and re-fetches for new host
- **Remove running container**: require confirmation toast action
- **Log stream cleanup**: `onBeforeQuit` + session disconnect → stop all active streams

---

## Implementation order

1. Rust: local docker commands (bollard, containers only)
2. UI: ContainerList + ContainerRow + basic actions
3. Rust: log streaming
4. UI: LogsView
5. Rust: remote SSH exec channel docker commands
6. UI: Images / Volumes / Networks tabs
7. Polish: error states, empty states, loading skeletons
