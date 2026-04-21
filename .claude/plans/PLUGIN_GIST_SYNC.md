# Plugin: GitHub Gist Sync

Sync full app state across devices via encrypted GitHub Gist — no Voltius account required.  
CRDT merge semantics identical to cloud sync. AES-256-GCM encrypted client-side.

---

## What's Already Available (no new API needed)

| Need | API |
|------|-----|
| Store PAT + passphrase securely | `api.vault.get/set` (`vault` permission) |
| Store gist ID, device ID, timestamps | `api.storage.get/set` |
| GitHub REST calls | `api.http.get/post` |
| Progress / error / success UI | `api.notifications.progress/toast/banner` |
| Reload stores post-import | `api.sync.triggerReload(storeKey)` |
| Flush state before app closes | `api.lifecycle.onBeforeQuit` |
| Custom settings UI | `api.ui.registerSettingsPage` |

---

## One API Gap: State Export / Import

`sync.getBlob/setBlob` is local plugin KV storage only — not the CRDT app state.  
Need two new methods on the `sync` namespace in `api.ts` + `runtime.ts`:

```ts
sync: {
  // ... existing methods unchanged ...

  /**
   * Export full app state as an encrypted blob (same format as cloud sync).
   * encKey: hex string, 32 bytes (caller derives via PBKDF2).
   * Returns base64-encoded blob.
   * Permission: sync:write
   */
  exportState(encKey: string, deviceId: string): Promise<string>;

  /**
   * CRDT-merge one or more remote blobs into local state, then reload stores.
   * blobs: base64-encoded blobs (one per remote device).
   * Permission: sync:write
   */
  importStates(encKey: string, blobs: string[]): Promise<void>;
}
```

### Implementation (runtime.ts, ~50 lines)

```ts
async exportState(encKey, deviceId) {
  requirePerm(manifest, 'sync:write');
  const blob: number[] = await invoke('backup_export', {
    encKey, accountId: 'gist-sync', deviceId,
  });
  // base64 encode
  return btoa(String.fromCharCode(...new Uint8Array(blob)));
},

async importStates(encKey, blobs) {
  requirePerm(manifest, 'sync:write');
  // Start from local raw state
  let { files: mergedFiles, secrets: mergedSecrets } =
    await invoke<BlobPayload>('state_export_raw');

  for (const b64 of blobs) {
    const blob = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const remote = await invoke<BlobPayload>('backup_decrypt', { encKey, blob });
    // Same CRDT merge as syncNow()
    for (const file of ENTITY_FILES) {
      mergedFiles[file] = mergeEntities(
        parseEntities(mergedFiles[file] ?? '[]'),
        parseEntities(remote.files[file] ?? '[]'),
      );
    }
    mergedSecrets = { ...mergedSecrets, ...remote.secrets };
  }

  await invoke('state_import', { files: mergedFiles, secrets: mergedSecrets });
  for (const key of Object.keys(RELOADABLE_STORES)) {
    await RELOADABLE_STORES[key]();
  }
},
```

> `mergeEntities` + `parseEntities` + `ENTITY_FILES` are already in `sync.ts` — import or extract to shared util.

---

## Gist Structure

```
gist (private, description: "Voltius Sync — do not edit manually")
├── manifest.json       → { schema: 1, salt: "<hex>", devices: [{id, label, pushedAt}] }
└── device-{id}.b64     → base64(AES-256-GCM encrypted CRDT blob)
```

- **Private gist** — accessible only via PAT, not indexed publicly
- **One file per device** — each device pushes its own blob, reads all others
- **manifest.json** is plaintext — salt + device registry, no sensitive data

---

## Encryption

All WebCrypto, no new deps:

```ts
// crypto.ts
export async function deriveKey(passphrase: string, saltHex: string): Promise<CryptoKey> {
  const salt = hexToBytes(saltHex);
  const baseKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 300_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true,           // extractable → need raw bytes for Tauri
    ['encrypt', 'decrypt'],
  );
}

export async function keyToHex(key: CryptoKey): Promise<string> {
  const raw = await crypto.subtle.exportKey('raw', key);
  return bytesToHex(new Uint8Array(raw));
}
```

Flow: `passphrase + salt → PBKDF2 → CryptoKey → hex → passed to Tauri as encKey`

- **Salt**: 16 random bytes, generated once on gist creation, stored in `manifest.json`
- **PAT**: stored in `api.vault.set('pat', token)`
- **Passphrase**: stored in `api.vault.set('passphrase', pass)` (vault is encrypted at rest)
- **Key**: derived fresh each session from vault-retrieved passphrase + manifest salt — never persisted

---

## Sync Loop

```
Startup (vault unlocked):
  if configured → pull-and-merge

setInterval every N seconds (user-configurable, default 60s):
  pull-and-merge

After local mutation detected (polling manifest.json pushedAt):
  push

lifecycle.onBeforeQuit:
  push (4s budget — inside onBeforeQuit's 5s limit)
```

### Push
```ts
async function push() {
  const encKey = await getEncKey();       // derive from vault passphrase + manifest salt
  const deviceId = await getDeviceId();   // from api.storage, uuid generated once
  const blob = await api.sync.exportState(encKey, deviceId);
  await gistApi.patchFiles(gistId, {
    [`device-${deviceId}.b64`]: { content: blob },
    'manifest.json': { content: JSON.stringify(updateManifestDevice(manifest, deviceId)) },
  });
}
```

### Pull-and-merge
```ts
async function pull() {
  const manifest = await gistApi.getFile(gistId, 'manifest.json');
  const encKey = await getEncKey();
  const myId = await getDeviceId();
  const remoteBlobs = await Promise.all(
    manifest.devices
      .filter(d => d.id !== myId)
      .map(d => gistApi.getFile(gistId, `device-${d.id}.b64`))
  );
  if (remoteBlobs.length === 0) return;
  await api.sync.importStates(encKey, remoteBlobs);
}
```

### Change detection (no websocket)
On each poll: compare `manifest.devices[*].pushedAt` vs. locally cached values.  
If any changed → pull. If local state was mutated since last push → push.

---

## Notifications

| Event | Notification |
|-------|-------------|
| First-time sync running | `progress('Syncing via GitHub Gist…')` |
| Sync success | `progress.finish('Gist sync complete')` (auto-dismiss 2s) |
| PAT invalid (401) | `banner('Gist Sync: invalid PAT — update in Settings', { severity: 'error', actions: [{label: 'Open Settings', onClick}] })` |
| Gist not found (404) | `banner('Gist Sync: gist not found — re-configure in Settings', { severity: 'error' })` |
| Network error (offline) | `toast('Gist sync skipped — offline', { severity: 'warning' })` |
| Setup complete | `toast('GitHub Gist Sync ready', { severity: 'success' })` |

Silent poll failures (transient network): retry next interval, no toast.  
Persistent failure (3 consecutive errors): escalate to banner.

---

## Settings Page

Custom page via `api.ui.registerSettingsPage`:

```
[ GitHub Gist Sync ]

GitHub PAT       [••••••••••••••••]  [Save]     ← api.vault('pat')
                 Needs gist scope. Create at github.com/settings/tokens

Sync Passphrase  [••••••••••••••••]  [Save]     ← api.vault('passphrase')
                 Used to encrypt your data. Never leaves this device.

Gist             Not configured
                 [Create New Gist]  [Link Existing ID: _________]

                 After setup:
                 https://gist.github.com/{user}/{id}  [Copy] [Unlink]

Status           ● Synced 2 minutes ago        [Sync Now]
Interval         [60] seconds

Devices (2 active)
  ┌─ This device  (abc123…)   last push: just now
  └─ MacBook Pro  (def456…)   last push: 3h ago    [Remove]
```

"Remove device" → delete `device-{id}.b64` from gist + remove from manifest.  
"Unlink" → clears gist ID from storage, disables sync (doesn't delete gist).

---

## Manifest

```ts
{
  id: 'gist-sync',
  name: 'GitHub Gist Sync',
  version: '1.0.0',
  description: 'Sync across devices via encrypted GitHub Gist — no account required.',
  permissions: ['vault', 'storage', 'http', 'ui', 'sync:read', 'sync:write', 'notifications'],
  defaultEnabled: false,   // opt-in — no-op until PAT + passphrase + gist configured
}
```

`defaultEnabled: false` because the plugin is inert until configured. User enables in Settings → Plugins.

---

## File Structure

```
src/plugins/gist-sync/
├── index.ts           ← manifest + register fn, lifecycle wiring, sync loop init
├── gist-api.ts        ← GitHub Gist REST (get file, patch files, create gist)
├── crypto.ts          ← PBKDF2 key derivation + hex helpers (WebCrypto only)
├── sync-engine.ts     ← push(), pull(), change detection, retry logic
└── SettingsPage.tsx   ← PAT / passphrase / gist URL / device list UI
```

Register in `src/plugins/bundled.ts` alongside `core-actions`, `ssh-config`, `import-export`.

---

## Implementation Order

| Step | File(s) | Notes |
|------|---------|-------|
| 1 | `src/plugins/api.ts` | Add `exportState` + `importStates` to `sync` interface |
| 2 | `src/plugins/runtime.ts` | Implement them (extract `mergeEntities` from sync.ts if needed) |
| 3 | `gist-sync/crypto.ts` | PBKDF2 derive, no deps |
| 4 | `gist-sync/gist-api.ts` | GitHub REST wrapper using `api.http` |
| 5 | `gist-sync/sync-engine.ts` | push / pull / change detection / retry |
| 6 | `gist-sync/index.ts` | Register, lifecycle hooks, poll interval |
| 7 | `gist-sync/SettingsPage.tsx` | Settings UI |
| 8 | `src/plugins/bundled.ts` | Register plugin |

---

## Edge Cases

| Case | Handling |
|------|---------|
| First device — gist empty | Push only, no pull |
| Two devices push simultaneously | Last write wins on gist file; CRDT merge handles divergence on next pull |
| Passphrase changed | Old blobs can't be decrypted — show error banner, prompt re-encryption |
| Gist deleted externally | 404 → banner, offer to create new |
| Blob > 1MB | `backup_export` has no plugin-imposed size limit; gist supports up to 100MB per file — not a concern |
| Cloud sync + gist sync both active | Both run independently; CRDT is idempotent, double-merge is safe |
| Vault locked | `api.vault.get` returns null → plugin skips sync silently until vault unlocked |
| Device label | Stored in `api.storage('deviceLabel')`, defaults to OS hostname via `navigator.userAgent` heuristic |

---

## What This Is NOT

- Not a replacement for cloud sync (coexists safely)
- Not real-time (poll-based, ~60s latency)
- Not zero-config (requires GitHub account + PAT)
- No team vault support (personal state only — team keys require X25519 wrapping, out of scope)
