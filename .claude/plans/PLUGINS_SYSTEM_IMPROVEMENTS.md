# Plugin System Improvements Plan

Inspiration: VSCode extension model. Scope: powerful enough for serious third-party plugins — not artificially restricted. Users are responsible for plugins they install.

---

## Design Philosophy

- **Zero Rust required for plugin authors** — plugins are TypeScript modules, bundled to a single `.js`
- **Power over sandboxing** — `sendCommand`, `fs`, `http` are available to plugins. Security boundary = user trust, not runtime jail
- **Performance is the only hard limit** — no raw terminal output streaming, no blocking the main thread
- **Sources = git repos** — any GitHub (or compatible) repo with a `plugins.json` index can be a source. First-party source is pre-seeded and undeletable (but disableable)

---

## Example Use Cases (scope anchor)

| Plugin | APIs it needs |
|--------|---------------|
| **Docker manager** | `lifecycle.onConnectionEstablished`, `sessions.sendCommand`, `ui.registerRightPanelSection`, `notifications` |
| **Port monitor** | `lifecycle`, `notifications`, `ui.registerRightPanelSection` |
| **Vault / secrets** | `storage`, `connections:read`, `plugins.expose()` |
| **SSH config sync** | `connections:write`, `sync.setBlob`, `lifecycle.onBeforeQuit` |
| **AWS SSM** | `connections:write`, `http`, `vault:read` (for credentials) |
| **Catppuccin theme** | `themes.register()` |

---

## Phase 1 — Core API Gaps ✅ DONE

### ✅ 1.1 Lifecycle Callbacks

Dropped `activationEvents` / lazy `register()` — overkill. All plugins activate at startup.

- `lifecycle.onConnectionEstablished/Closed`: session store subscription, status transition tracking
- `lifecycle.onSessionActivated`: fires on active tab change
- `lifecycle.onSettingsChanged`: fires when this plugin's `storage.set()` is called
- `lifecycle.onBeforeQuit`: Tauri `onCloseRequested`, 5s timeout then `win.destroy()`

**Files:** `src/plugins/api.ts`, `src/plugins/runtime.ts`

---

### ✅ 1.2 Sync / Blob API

- `sync.getBlob/setBlob`: backed by Tauri plugin storage as base64, max 1MB
- `sync.onRemoteChange`: hooks into `onSyncStateChange`, fires if value changed after sync
- `sync.triggerReload(storeKey)`: reloads named stores (`connections`, `identities`, `keys`, `snippets`, `folders`)

**Known limitation — deferred:** Cross-device blob sync requires adding plugin storage to Tauri `backup_export` / `backup_decrypt`. API is wired and forward-compatible. Not blocking any current use case.

**Files:** `src/plugins/api.ts`, `src/plugins/runtime.ts`

---

### ✅ 1.3 Inter-Plugin Communication

Dropped dependency graph / topological sort — overkill.

- `plugins.expose(api)`: publishes plugin's surface to a module-level map
- `plugins.getApi(pluginId)`: returns surface or null — consumers degrade gracefully

**Files:** `src/plugins/api.ts`, `src/plugins/runtime.ts`

---

### ✅ 1.4 Declarative Settings Schema

- `contributes.configuration` on `PluginManifest`: typed fields (string, number, boolean, select, secret)
- Defaults auto-populated on `loadPlugin`
- `storage.set()` validates against schema, throws `PluginTypeError` on mismatch
- `PluginConfigForm` auto-generates settings UI — shown in PluginsSection when no custom page registered

**Files:** `src/plugins/api.ts`, `src/plugins/runtime.ts`, `src/components/settings/sections/PluginsSection.tsx`

---

### ✅ 1.5 Context Menu `when` Conditions

- `when?: (context: unknown) => boolean` on `ContributedAction`
- Evaluated at render time in `useUIContributions.ts` — throws treated as false, never crashes

**Files:** `src/plugins/api.ts`, `src/hooks/useUIContributions.ts`

---

## Phase 2 — Richer Interaction ✅ DONE

### ✅ 2.1 Sessions API

- `sessions.list()`: snapshot of current sessions from session store
- `sessions.onConnected/onDisconnected/onActivated`: reuse lifecycle session store subscription
- `sessions.sendCommand(sessionId, cmd)`: encodes via `TextEncoder` + `\n`, calls `sshSendInput` (SSH) or `local_send_input` (local shell)

**Security note:** `sendCommand` is intentionally powerful. Plugin authors can write to terminal sessions. Users are responsible for plugins they install — this is by design, not an oversight.

**Files:** `src/plugins/api.ts`, `src/plugins/runtime.ts`

---

### ✅ 2.2 Keybinding Contributions

- `keybinding?` field on `OmniCommand` — format: `"ctrl+shift+p"`, `"meta+k"`
- Module-level `keydown` capture listener (installed once on first use)
- First-registered wins on conflict, second logs warning
- Formatted keybinding badge rendered in command palette

**Files:** `src/plugins/api.ts`, `src/plugins/runtime.ts`, `src/components/omni/OmniSearch.tsx`

---

### ✅ 2.3 Plugin Panel Sections

- `ui.registerRightPanelSection` already existed in API + pluginStore — just needed UI wiring
- `RightPanelSection` type widened to `BuiltinSection | (string & {})` to allow `"plugin:*"` IDs
- `RightPanel.tsx` reads `pluginStore.rightPanelSections`, appends tabs dynamically, renders component lazily

**Files:** `src/stores/uiStore.ts`, `src/components/terminal/RightPanel.tsx`

---

## Phase 3 — External Plugin Loading ✅ DONE

### Overview

Plugin bundle format: **single `.js` + `manifest.json` in a named folder.**

```
$APP_DATA/plugins/
  docker-manager/
    manifest.json    ← PluginManifest shape
    index.js         ← esbuild/rollup single-file bundle
  catppuccin-theme/
    manifest.json
    index.js
```

Why single file: install = write 2 files (no extraction), dev workflow = edit in place + reload, authors use esbuild in one command, assets embedded as base64 or fetched via CDN.

Loading: dynamic import via `convertFileSrc` (Tauri asset protocol → WebView-accessible URL).

---

### 3.1 Rust Commands (new — required)

Three new Tauri commands needed — TypeScript `fs` API is scoped to home dir, can't reach `$APP_DATA`:

| Command | Purpose |
|---------|---------|
| `plugins_list_installed` | List subdirs of `$APP_DATA/plugins/`, return names |
| `plugin_write_file(id, filename, content)` | Write a file into `$APP_DATA/plugins/<id>/` |
| `plugin_delete(id)` | Delete `$APP_DATA/plugins/<id>/` and all contents |

CSP update needed in `tauri.conf.json`: allow `script-src` for the Tauri asset protocol so dynamic imports of local `.js` files work.

---

### 3.2 Startup Loader

In `runtime.ts`, after bundled plugins load:

```ts
export async function loadInstalledPlugins(): Promise<void> {
  const ids = await invoke<string[]>('plugins_list_installed')
  for (const id of ids) {
    const manifest = JSON.parse(await invoke('plugin_read_manifest', { id }))
    const url = convertFileSrc(await resolvePluginPath(id, 'index.js'))
    const mod = await import(/* @vite-ignore */ url)
    loadPlugin(manifest, mod.default)
  }
}
```

Called once at app startup (after vault unlock if needed).

Hot-reload for dev: re-call `unloadPlugin(id)` + `loadInstalledPlugins()` for a specific id. No watcher needed — manual trigger from PluginsSection "Reload" button.

---

### 3.3 Marketplace Store (`src/stores/marketplaceStore.ts`)

```ts
interface MarketplaceSource {
  id: string
  name: string
  url: string          // URL to plugins.json
  enabled: boolean
  deletable: boolean   // false for first-party
}

interface MarketplacePlugin {
  id: string
  name: string
  author: string
  description: string
  repo: string         // "owner/repo" (GitHub) or direct URL
  version: string
  minAppVersion?: string
  tags: string[]
  theme: boolean
  sourceId: string     // which source it came from
}

interface InstalledPluginMeta {
  id: string
  version: string
  sourceId: string | 'local' | 'url'
}
```

**First-party source** pre-seeded:
```ts
{ id: 'voltius', name: 'Voltius Marketplace', url: 'https://raw.githubusercontent.com/voltius/marketplace/main/plugins.json', deletable: false }
```

**Install flow:**
1. Resolve download URL: `https://github.com/{repo}/releases/latest/download/index.js` (+ `manifest.json`)
2. `fetch()` both files
3. `invoke('plugin_write_file', { id, filename: 'manifest.json', content })` × 2
4. Dynamic import + `loadPlugin`
5. Write to `installed-plugins.json` in app data (list of `InstalledPluginMeta`)

**Uninstall flow:**
1. `unloadPlugin(id)`
2. `invoke('plugin_delete', { id })`
3. Remove from `installed-plugins.json`

---

### 3.4 PluginsSection UI Rework

Two-tab layout: **Installed** | **Browse**

**Installed tab** (current view + additions):
- All bundled plugins (existing cards)
- All externally installed plugins (same card style + version badge + "Uninstall" + "Reload" button)
- "Update available" badge when installed version < marketplace version

**Browse tab:**
- Search bar + tag filter chips
- Source badge on each result (first-party vs custom)
- Install button → progress notification → done
- "Installed" badge if already installed

**Sources panel** (gear icon or sub-section in Browse):
- List of configured sources with enable/disable toggle
- First-party source: no delete button
- "Add source" → URL input → fetch + validate `plugins.json` → save

---

### 3.5 Dev Workflow (local folder)

For plugin developers:
- Drop folder into `$APP_DATA/plugins/<id>/` with `manifest.json` + `index.js`
- App lists it automatically on next startup (or after manual "Scan" in PluginsSection)
- "Reload" button in Installed tab re-imports the `.js` without restarting the app
- No hot-watcher on the file system — manual trigger is enough for dev loop

---

## Open / Future Work

| Item | Notes |
|------|-------|
| 1.2 cross-device blob sync | Tauri `backup_export` / `backup_decrypt` need plugin storage included — Rust change, low priority |
| 1.4 schema migration warning | Currently wipes silently — could log console warning |
| Signature verification | Check plugin `.js` against a hash in `plugins.json` before loading — Phase 3 v2 |
| Update notifications | Check installed vs latest version on startup, badge in TitleBar |
| `plugin-gist-sync` bundled plugin | Gist-based sync backend — referenced in PLUGIN_SYSTEM.md |

---

## Resolved Technical Decisions

| Question | Decision |
|----------|----------|
| `storage.set()` type mismatch | Throws `PluginTypeError` |
| Schema migration on conflict | Wipe old value, apply default |
| `when()` async? | No — sync only |
| `sendCommand` newline | Runtime appends `\n` |
| Keybinding conflict | First-registered wins, logs warning |
| Platform keys | `meta`/`ctrl` normalized by runtime per OS |
| Blob size limit | 1MB, throws `PluginStorageError` |
| `onBeforeQuit` timeout | 5s then force-quit |
| Plugin bundle format | Single `.js` + `manifest.json` in named folder |
| Sandbox | No Web Worker sandbox — permission checks are the boundary. Users trust plugins they install. |
| First-party source | Pre-seeded, `deletable: false`, disableable |
| Install download | GitHub Releases latest asset (`index.js` + `manifest.json`) |
| Dev workflow | Drop folder manually, "Reload" button in UI — no file watcher |

---

## Dependency Map

```
Phase 1 ✅ → all done
Phase 2 ✅ → all done
Phase 3.1 (Rust cmds)   → blocks 3.2, 3.3
Phase 3.2 (Loader)      → blocks 3.4 (UI needs installed list)
Phase 3.3 (Store)       → blocks 3.4
Phase 3.4 (UI)          → final, depends on 3.1–3.3
```

---

## Files Touch Map

| File | Phase | Status |
|------|-------|--------|
| `src/plugins/api.ts` | 1, 2 | ✅ Done |
| `src/plugins/runtime.ts` | 1, 2, 3.2 | Phase 1+2 done |
| `src/hooks/useUIContributions.ts` | 1.5 | ✅ Done |
| `src/stores/uiStore.ts` | 2.3 | ✅ Done |
| `src/components/terminal/RightPanel.tsx` | 2.3 | ✅ Done |
| `src/components/omni/OmniSearch.tsx` | 2.2 | ✅ Done |
| `src/components/settings/sections/PluginsSection.tsx` | 1.4, 3.4 | 1.4 done |
| `src/stores/marketplaceStore.ts` | 3.3 | ✅ Done |
| `src-tauri/src/commands/plugins.rs` | 3.1 | ✅ Done |
| `tauri.conf.json` | 3.1 | ✅ CSP null — already open |
