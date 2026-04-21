# Plugin Notifications API Plan

Standalone plan. Plugins need a way to surface information in the UI beyond `log.info()`.

---

## Goals

- Plugins show toasts and progress indicators (bottom-right, VSCode-style)
- Persistent/banner notifications live in a bell dropdown in the TitleBar
- Consistent with app's native notification style
- Non-blocking (no alert() / modal for simple messages)
- Permission-gated to prevent notification spam

---

## API Design

Permission: `notifications` (required for all notification calls)

```ts
notifications: {
  // Fire-and-forget toast — appears bottom-right, auto-dismisses
  toast(message: string, opts?: ToastOptions): void

  // Progress notification — appears bottom-right, manual resolve
  progress(title: string, opts?: ProgressOptions): ProgressHandle

  // Persistent notification — lives in bell dropdown, optional brief toast on creation
  banner(message: string, opts?: BannerOptions): BannerHandle
}
```

### Types

```ts
type ToastSeverity = 'info' | 'success' | 'warning' | 'error'

interface ToastOptions {
  severity?: ToastSeverity      // default: 'info'
  duration?: number             // ms, default: 4000, 0 = sticky until dismissed
  action?: {
    label: string
    onClick: () => void
  }
}

interface ProgressOptions {
  indeterminate?: boolean       // spinner vs. bar, default: true
  cancellable?: boolean         // show cancel button
}

interface ProgressHandle {
  update(value: number, message?: string): void   // 0–100
  finish(message?: string): void
  error(message: string): void
  cancel(): void
}

interface BannerOptions {
  severity?: ToastSeverity
  actions?: Array<{ label: string; onClick: () => void }>
  dismissable?: boolean         // default: true
  flashToast?: boolean          // brief toast on creation? default: true
}

interface BannerHandle {
  dismiss(): void
  update(message: string): void
}
```

---

## Usage Examples

```ts
// Simple toast
api.notifications.toast('SSH config synced', { severity: 'success' })

// Toast with action
api.notifications.toast('3 new connections found', {
  severity: 'info',
  action: { label: 'Import', onClick: () => doImport() }
})

// Progress bar for long operation
const progress = api.notifications.progress('Importing connections...')
for (let i = 0; i < connections.length; i++) {
  await importOne(connections[i])
  progress.update((i / connections.length) * 100, connections[i].name)
}
progress.finish('Import complete')

// Persistent notification in bell dropdown
const banner = api.notifications.banner('SSH config file not found', {
  severity: 'error',
  actions: [{ label: 'Create file', onClick: createConfigFile }]
})
// Later...
banner.dismiss()
```

---

## UX Architecture

### Toasts — bottom-right stack (like VSCode)

- `toast()` and `progress()` → appear in fixed bottom-right stack
- Newest on bottom, older stack up
- Max 5 visible; overflow logic described below
- Auto-dismissed after `duration` ms (default 4000)
- Sticky (`duration: 0`) and progress toasts stay until resolved

### Bell dropdown — persistent notification center

- `lucide:bell` button in TitleBar right section (before window controls)
- Red dot badge when unread notifications present (count capped display at `9+`)
- Click bell → opens positioned dropdown (portal-based, same pattern as vault/account dropdowns)
- `banner()` creates a persistent entry here; also briefly flashes as a toast (3 s) unless `flashToast: false`
- Dropdown lists all active banners + last 50 dismissed/finished toasts as history
- "Clear all" link clears history (not active banners)
- Bell unread count resets when dropdown opens

---

## UI / UX Specification

### Toast Stack

- **Position:** `fixed bottom-4 right-4`, z-50 — alongside existing `PfToastContainer` (which gets migrated in)
- **Stack order:** newest appended at bottom, older items above
- **Width:** `min-w-64 max-w-sm`
- **Animation:** `animate-fadeIn` on enter; opacity fade-out class before removal (add `animate-fadeOut` keyframe if missing)
- **Hover behavior:** hovering anywhere on the stack pauses ALL auto-dismiss timers. Timers resume on mouse leave. Prevents toasts disappearing mid-read.
- **Anatomy per toast:**
  ```
  [2px left border] [severity icon] [plugin label] message  [action btn?] [×]
  ```
- **Plugin label:** `[plugin-name]` — `text-[var(--t-text-dim)] text-xs`, truncated to 20 chars
- **Progress toast anatomy:**
  ```
  [spinner OR bar]  Title          sub-message   [× cancel?]
                    ████████░░ 68%
  ```
  - Indeterminate: `lucide:loader-circle animate-spin`, no percentage
  - Determinate: `<div>` progress bar, `value%` label
  - `finish()` → switches to success state, auto-dismisses after 2 s
  - `error()` → switches to error state, sticky until dismissed

### Severity Colors

All use CSS vars — no hardcoded hex:

| Severity | Icon | Left border + badge | BG tint |
|----------|------|---------------------|---------|
| `info`   | `lucide:info` `--t-text-muted` | `--t-accent` | `color-mix(in srgb, var(--t-accent) 8%, transparent)` |
| `success`| `lucide:check-circle` `--t-status-connected` | `--t-status-connected` | `color-mix(in srgb, var(--t-status-connected) 8%, transparent)` |
| `warning`| `lucide:triangle-alert` `--t-status-warning` | `--t-status-warning` | `color-mix(in srgb, var(--t-status-warning) 8%, transparent)` |
| `error`  | `lucide:x-circle` `--t-status-error` | `--t-status-error` | `color-mix(in srgb, var(--t-status-error) 8%, transparent)` |

### Bell Dropdown

- **Trigger:** `lucide:bell` icon button in TitleBar, same style as other titlebar icon buttons
- **Badge:** absolute-positioned red dot (`--t-status-error` bg) with white count text; hidden when 0 unread; shows `9+` above 9
- **Dropdown:** `absolute top-full right-0 mt-1`, `w-80`, `bg-[var(--t-bg-modal)] border border-[var(--t-border)] rounded-xl shadow-xl`, z-50, portal-rendered to `document.body` (same as vault/account dropdowns)
- **Sections:**
  - **Active** — progress toasts still running + banner entries with actions
  - **Recent** — last 50 dismissed/finished toasts, sorted newest first, grayed-out relative timestamp (`2 min ago`)
- **Each entry:** severity icon + `[plugin]` label + message + action buttons + × dismiss (if dismissable)
- **Header row:** `Notifications` title left, `Clear history` button right (disabled if no history)
- **Empty state:** `lucide:bell-off` icon + "No notifications"
- **Click outside:** closes dropdown (same `mousedown` listener pattern as vault dropdown)

---

## Theme Change: `statusWarning`

Add `statusWarning` field to `UITheme` (for `--t-status-warning` CSS var).

### `src/themes/types.ts`

Add to `UITheme`:
```ts
statusWarning: string;
```

### `src/hooks/useApplyTheme.ts`

Add:
```ts
root.style.setProperty("--t-status-warning", ui.statusWarning);
```

### `src/themes/presets.ts` — values per theme

| Theme | `statusWarning` |
|-------|----------------|
| Abyss | `#F59E0B` (already used as `statusConnecting`) |
| Voltius Dark | `#F59E0B` |
| Dracula | `#ffb86c` (existing `statusConnecting` value) |
| Nord | `#EBCB8B` (existing `statusConnecting`) |
| Monokai | `#fd971f` (existing `statusConnecting`) |
| Tokyo Night | `#e0af68` (existing `statusConnecting`) |

Note: `statusWarning` and `statusConnecting` are intentionally the same amber color in all presets — they are semantically distinct slots (one is a notification severity, one is a connection state). Keeping them separate allows future themes to differentiate.

---

## Edge Cases & Clarifications

### Duplicate suppression
No deduplication by default. Caller tracks own state if needed.

### `banner()` flash toast
When `flashToast: true` (default), a 3 s non-sticky toast appears. It auto-dismisses from the toast stack but the notification stays in the bell dropdown. Clicking the toast's action or × doesn't affect the dropdown entry.

### onClick callbacks
Direct function calls (same process, same closure). If plugin unloaded while toast still visible: action button becomes `opacity-50 pointer-events-none` — not removed (avoids layout shift). BannerHandle actions are hidden if plugin unloaded.

### `ProgressHandle.cancel()` semantics
Dismisses from UI AND fires the plugin-provided cancel callback. Plugin is responsible for stopping its async work. No interrupt mechanism.

### `finish()` / `error()` after unload
`notificationStore.updateToast(id, ...)` no-ops if id not found — guard with existence check. No crash.

### Plugin unload cleanup
```ts
// In runtime.ts unloadPlugin():
useNotificationStore.getState().dismissAllForPlugin(pluginId)
```
All toasts removed immediately (no finish animation). All banners removed from dropdown. Active progress toasts force-dismissed.

### Progress timeout
Progress toasts not resolved within 5 minutes auto-error with "Operation timed out". A `useEffect` interval in `NotificationToastContainer` checks `timedOutAt` every 30 s.

### Toast overflow (max 5)
When a 6th toast arrives: drop oldest non-sticky non-progress toast. If none available: drop incoming silently. Progress and sticky toasts are protected.

### Banner overflow (max 10 in dropdown)
When >10 active banners: oldest dismissable banner auto-dismissed. If all non-dismissable: drop incoming.

### Notification history cap
Store keeps last 50 history entries. On add: if >50, `history.shift()`.

### Bell unread count
Incremented on every `addToast` and `addBanner` call. Reset to 0 when dropdown opens (`markAllRead()`).

### ID generation
`crypto.randomUUID()` — available in Tauri's Chromium WebView. Prefixed: `${pluginId}:${uuid}`.

### `PfToastContainer` migration
Port-forwarding toasts move into `notificationStore` with `pluginId: '__pf__'`, `pluginName: 'Port Forwarding'`. The existing `PfToastContainer.tsx` component is deleted. The `<PfToastContainer />` mount in `App.tsx` is replaced by the new `<NotificationToastContainer />` which handles all toasts. The Tauri `pf-port-detected` listener moves into a `usePfToastBridge()` hook called from `App.tsx`.

---

## Implementation

### Files

| File | Change |
|------|--------|
| `src/themes/types.ts` | Add `statusWarning: string` to `UITheme` |
| `src/hooks/useApplyTheme.ts` | Add `--t-status-warning` CSS var mapping |
| `src/themes/presets.ts` | Add `statusWarning` value to all 6 themes |
| `src/plugins/api.ts` | Add `notifications` to `PluginAPI` interface + all types |
| `src/plugins/runtime.ts` | Implement `notifications` factory; add `dismissAllForPlugin` call in `unloadPlugin()` |
| New: `src/stores/notificationStore.ts` | Zustand store: toast queue, banner list, history, unread count |
| New: `src/components/notifications/NotificationToastContainer.tsx` | Bottom-right toast stack (replaces `PfToastContainer`) |
| New: `src/components/notifications/ProgressToast.tsx` | Progress variant toast subcomponent |
| New: `src/components/notifications/NotificationBell.tsx` | Bell icon button + dropdown (mounts in TitleBar) |
| New: `src/hooks/usePfToastBridge.ts` | Tauri `pf-port-detected` → `notificationStore.addToast()` |
| `src/components/layout/TitleBar.tsx` | Add `<NotificationBell />`, call `usePfToastBridge()`, remove PfToastContainer ref |
| `src/app/App.tsx` | Replace `<PfToastContainer />` with `<NotificationToastContainer />` |
| `src/components/shared/PfToastContainer.tsx` | **Delete** |

### `notificationStore.ts` shape

```ts
interface ToastEntry {
  id: string                       // `${pluginId}:${uuid}`
  pluginId: string
  pluginName: string               // truncated to 20 chars
  type: 'toast' | 'progress'
  message: string
  severity: ToastSeverity
  duration: number                 // 0 = sticky
  action?: { label: string; onClick: () => void }
  // Progress fields
  progress?: number                // undefined = indeterminate
  cancellable?: boolean
  onCancel?: () => void
  finished?: boolean
  finishedSeverity?: ToastSeverity
  timedOutAt?: number
  // Meta
  createdAt: number
}

interface BannerEntry {
  id: string
  pluginId: string
  pluginName: string
  message: string
  severity: ToastSeverity
  actions: Array<{ label: string; onClick: () => void }>
  dismissable: boolean
  createdAt: number
}

interface HistoryEntry {
  id: string
  pluginId: string
  pluginName: string
  message: string
  severity: ToastSeverity
  dismissedAt: number
}

interface NotificationStore {
  toasts: ToastEntry[]
  banners: BannerEntry[]
  history: HistoryEntry[]          // capped at 50, newest first
  unreadCount: number

  addToast(entry: Omit<ToastEntry, 'id' | 'createdAt'>): string
  updateToast(id: string, patch: Partial<ToastEntry>): void
  dismissToast(id: string): void   // moves to history

  addBanner(entry: Omit<BannerEntry, 'id' | 'createdAt'>): string
  updateBanner(id: string, patch: Partial<BannerEntry>): void
  dismissBanner(id: string): void

  dismissAllForPlugin(pluginId: string): void
  markAllRead(): void              // sets unreadCount = 0
  clearHistory(): void
}
```

No persistence — ephemeral by design.

### `notifications` factory skeleton (runtime.ts)

```ts
function createNotificationsAPI(manifest: PluginManifest): PluginAPI['notifications'] {
  requirePerm(manifest, 'notifications')
  const pluginName = manifest.name.slice(0, 20)

  return {
    toast(message, opts = {}) {
      const { severity = 'info', duration = 4000, action } = opts
      useNotificationStore.getState().addToast({
        pluginId: manifest.id, pluginName, type: 'toast',
        message, severity, duration, action,
      })
    },

    progress(title, opts = {}) {
      const { indeterminate = true, cancellable = false } = opts
      let onCancel: (() => void) | undefined

      const id = useNotificationStore.getState().addToast({
        pluginId: manifest.id, pluginName, type: 'progress',
        message: title, severity: 'info', duration: 0,
        progress: indeterminate ? undefined : 0,
        cancellable,
        onCancel: () => onCancel?.(),
        timedOutAt: Date.now() + 5 * 60 * 1000,
      })

      return {
        update(value, msg) {
          useNotificationStore.getState().updateToast(id, {
            progress: value, ...(msg && { message: msg }),
          })
        },
        finish(msg) {
          useNotificationStore.getState().updateToast(id, {
            finished: true, finishedSeverity: 'success',
            ...(msg && { message: msg }),
          })
          setTimeout(() => useNotificationStore.getState().dismissToast(id), 2000)
        },
        error(msg) {
          useNotificationStore.getState().updateToast(id, {
            finished: true, finishedSeverity: 'error', message: msg, duration: 0,
          })
        },
        cancel() {
          onCancel?.()
          useNotificationStore.getState().dismissToast(id)
        },
      }
    },

    banner(message, opts = {}) {
      const { severity = 'info', actions = [], dismissable = true, flashToast = true } = opts
      const store = useNotificationStore.getState()
      const id = store.addBanner({
        pluginId: manifest.id, pluginName, message, severity, actions, dismissable,
      })
      if (flashToast) {
        store.addToast({
          pluginId: manifest.id, pluginName, type: 'toast',
          message, severity, duration: 3000,
        })
      }
      return {
        dismiss() { useNotificationStore.getState().dismissBanner(id) },
        update(msg) { useNotificationStore.getState().updateBanner(id, { message: msg }) },
      }
    },
  }
}
```

### Timer / hover-pause pattern (NotificationToastContainer)

```ts
const timers = useRef<Map<string, { id: ReturnType<typeof setTimeout>; remaining: number; startedAt: number }>>({})
const [hovered, setHovered] = useState(false)

// On new toast with duration > 0: start timer, store remaining
// On mouseEnter container: pause all → record remaining = remaining - (now - startedAt)
// On mouseLeave container: restart each timer with its remaining time
```

### Bell dropdown positioning (NotificationBell)

Same pattern as vault/account dropdowns in TitleBar:
```ts
const ref = useRef<HTMLButtonElement>(null)
const [open, setOpen] = useState(false)
const [pos, setPos] = useState({ top: 0, right: 0 })

const openBell = () => {
  if (ref.current) {
    const rect = ref.current.getBoundingClientRect()
    setPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right })
  }
  markAllRead()
  setOpen(o => !o)
}
// Portal render at pos, click-outside mousedown listener to close
```

---

## Open Questions — Resolved

| # | Question | Decision |
|---|----------|----------|
| 1 | Warning color | Add `statusWarning` to `UITheme` + all 6 presets + `useApplyTheme.ts` |
| 2 | Banner location | No banner strip. Bell icon in TitleBar opens dropdown. Persistent notifications live there. Toasts are bottom-right only. |
| 3 | PfToastContainer migration | Yes — migrate into notificationStore as `__pf__` system producer in v1 |
