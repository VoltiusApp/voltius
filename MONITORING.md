# Monitoring Plugin — Plan

## Overview

Bundled plugin at `src/plugins/monitoring/`. Adds a **Metrics** tab to the RightPanel.
Shows CPU / RAM / Disk / Network for the **active session's host** (local or remote SSH).
1s refresh. Sparkline graphs.

---

## Architecture

### Data flow

```
RightPanel (Metrics tab)
  └── MetricsPanel (React)
        └── Tauri events "metrics:snapshot:<session_id>"
              ▲
              Rust background task (per active session)
                ├── Local: sysinfo crate → snapshot every 1s
                └── Remote: SSH exec channel → shell one-liners every 1s
```

### Remote strategy

Reuse `russh` session infrastructure. Open a **persistent SSH exec channel** running a compact shell poller:

```sh
while true; do
  echo "{\"cpu\":$(grep 'cpu ' /proc/stat | awk '{printf "%.1f", ($2+$4)*100/($2+$3+$4+$5)}'),\"mem_used\":$(awk '/MemTotal/{t=$2}/MemAvailable/{a=$2}END{print t-a}' /proc/meminfo),\"mem_total\":$(awk '/MemTotal/{print $2}' /proc/meminfo),\"rx\":$(cat /proc/net/dev | awk 'NR>2{r+=$2}END{print r}'),\"tx\":$(cat /proc/net/dev | awk 'NR>2{t+=$10}END{print t}')}"
  sleep 1
done
```

Parse stdout line-by-line in Rust → emit Tauri events.
Disk: sampled every 10s (slower, less critical) via `df -P /`.

---

## Rust Backend

### New crate dep (Cargo.toml)

```toml
sysinfo = "0.33"    # local metrics — CPU, RAM, disk, network
```

### Commands

| Command | Args | Returns |
|---|---|---|
| `metrics_start` | `session_id?: string` | `stream_id: string` |
| `metrics_stop` | `stream_id` | `()` |
| `metrics_disk_snapshot` | `session_id?` | `Vec<DiskInfo>` |

### Event format

```
metrics:snapshot:<stream_id>  →  MetricsSnapshot {
  ts: number,               // unix ms
  cpu_percent: number,      // 0–100
  mem_used_kb: number,
  mem_total_kb: number,
  net_rx_bytes: number,     // cumulative, compute delta in frontend
  net_tx_bytes: number,
  disks: DiskInfo[],        // updated every 10s, null if unchanged
}
```

### Rust module structure

```
src-tauri/src/metrics/
  mod.rs
  local.rs       ← sysinfo poller
  remote.rs      ← SSH exec channel poller + stdout parser
  commands.rs    ← #[tauri::command] start/stop
  stream.rs      ← StreamManager: HashMap<stream_id, JoinHandle>
```

---

## Chart library

**Recommendation: `uplot`** (via `uplot` npm package, ~40KB minified)
- Fastest canvas-based charting — handles 1s updates with zero jank
- No React wrapper needed; mount on `useRef` canvas
- Simple sparkline config

React wrapper: mount via `useEffect` on a `useRef` canvas element. Destroy + recreate on data series change.

Thin wrapper component: `<Sparkline data={number[]} color={string} height={40} />`

---

## Plugin (TypeScript)

### Manifest

```ts
{
  id: "plugin-monitoring",
  permissions: ["sessions:read", "notifications"],
  defaultEnabled: true,
}
```

### Registration

```ts
api.ui.registerRightPanelSection({
  id: "monitoring",
  label: "Metrics",
  icon: "lucide:activity",
  component: MetricsPanel,
});
```

---

## UI Layout (300px wide)

```
┌─────────────────────────────┐
│ Metrics          ○ ssh-host │  ← host badge (green dot = streaming)
├─────────────────────────────┤
│ CPU              42%        │
│ ▁▂▄▆▃▅▇▄▂▃▅▆▄▂▃           │  ← 60s sparkline
├─────────────────────────────┤
│ RAM              6.1 / 16G  │
│ ▁▁▂▂▂▃▃▃▃▃▃▃▄▄▄           │
├─────────────────────────────┤
│ Network  ↓ 1.2MB/s ↑ 80KB/s│
│ ▁▁▃▅▃▁▁▁▂▂▁▁▁▁▁           │  ← rx only in chart, tx as number
├─────────────────────────────┤
│ Disk                        │
│ /      45.2G / 100G  45%   │  ← bar + numbers, refreshed 10s
│ /home  120G  / 500G  24%   │
└─────────────────────────────┘
```

Each metric card: label + current value (right-aligned) + 60-point sparkline (last 60s).

Network: show delta (bytes/s) computed from cumulative counters.

---

## State management

Component-local `useRef` for raw history buffer (avoid re-render on every tick):

```ts
const history = useRef<MetricsSnapshot[]>([]);  // max 60 entries
```

`useState` only for display values (trigger re-render at 1Hz is fine for 4 numbers + chart redraw).

On session switch → stop current stream, clear history, start new stream.

---

## File structure

```
src/plugins/monitoring/
  index.ts
  types.ts              ← MetricsSnapshot, DiskInfo
  components/
    MetricsPanel.tsx    ← root, stream lifecycle, session watch
    MetricCard.tsx      ← label + value + sparkline
    Sparkline.tsx       ← uplot/recharts wrapper
    DiskSection.tsx     ← disk bars
    NetworkCard.tsx     ← rx/tx delta display
```

---

## Constraints & edge cases

- **No session active**: panel shows "Connect to a host to see metrics"
- **Remote without /proc**: fallback to `top -bn1` / `vm_stat` (macOS); surface parse error gracefully
- **Session disconnect**: stop stream immediately, show "Disconnected" state
- **Multiple sessions**: stream tied to `activeSessionId` — switches on tab change via `api.sessions.onActivated`
- **High CPU from poller itself**: SSH exec channel is low overhead; sysinfo local is negligible
- **Stream leak on unmount**: cleanup in `useEffect` return + `api.lifecycle.onBeforeQuit`

---

## Implementation order

1. Rust: local metrics via `sysinfo` + event emission
2. UI: MetricsPanel skeleton + MetricCard + Sparkline (static fake data)
3. Wire up: live local metrics end-to-end
4. Rust: remote SSH exec channel poller
5. UI: session switching logic
6. Rust: disk snapshots (local + remote)
7. UI: DiskSection + NetworkCard delta math
8. Polish: empty states, error states, perf tuning
