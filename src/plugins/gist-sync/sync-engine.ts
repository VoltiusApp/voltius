import type { PluginAPI } from "@/plugins/api";
import {
  createGist,
  getManifest,
  getDeviceBlobs,
  patchFiles,
  deleteDeviceFile,
  deleteGistById,
  GistApiError,
  type GistManifest,
  type GistDevice,
} from "./gist-api";
import { deriveKey, keyToHex, generateSaltHex } from "./crypto";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GistRegistration {
  id: string;
  label?: string;
  addedAt: string;
}

// ─── State ────────────────────────────────────────────────────────────────────

let _api: PluginAPI;
let _pollInterval: ReturnType<typeof setInterval> | null = null;
let _consecutiveFailures = 0;
let _failureBannerId: { dismiss(): void } | null = null;
// deviceId → last known pushedAt (change detection for pull)
let _lastSeenPushedAt: Record<string, string> = {};

export function init(api: PluginAPI) {
  _api = api;
}

// ─── Config helpers ───────────────────────────────────────────────────────────

async function getPat(): Promise<string | null> {
  return _api.vault.get("pat");
}

async function getPassphrase(): Promise<string | null> {
  return _api.vault.get("passphrase");
}

/** Returns all registered gists, migrating from legacy single-gistId storage if needed. */
export async function getRegisteredGists(): Promise<GistRegistration[]> {
  const gists = await _api.storage.get<GistRegistration[]>("registeredGists");
  if (gists !== null) return gists;

  // Migrate from legacy single gistId
  const legacyId = await _api.storage.get<string>("gistId");
  if (legacyId) {
    const entry: GistRegistration = { id: legacyId, addedAt: new Date().toISOString() };
    await Promise.all([
      _api.storage.set("registeredGists", [entry]),
      _api.storage.set("importSourceId", legacyId),
      _api.storage.set("exportDestinationIds", [legacyId]),
      _api.storage.delete("gistId"),
    ]);
    return [entry];
  }
  return [];
}

async function saveRegisteredGists(gists: GistRegistration[]): Promise<void> {
  await _api.storage.set("registeredGists", gists);
}

export async function getImportSourceId(): Promise<string | null> {
  return _api.storage.get<string>("importSourceId");
}

export async function getExportDestinationIds(): Promise<string[]> {
  return (await _api.storage.get<string[]>("exportDestinationIds")) ?? [];
}

export async function setImportSource(gistId: string): Promise<void> {
  await _api.storage.set("importSourceId", gistId);
}

export async function setExportDestinations(gistIds: string[]): Promise<void> {
  await _api.storage.set("exportDestinationIds", gistIds);
}

export async function getDeviceId(): Promise<string> {
  let id = await _api.storage.get<string>("deviceId");
  if (!id) {
    id = crypto.randomUUID();
    await _api.storage.set("deviceId", id);
  }
  return id;
}

async function getDeviceLabel(): Promise<string> {
  const stored = await _api.storage.get<string>("deviceLabel");
  if (stored) return stored;
  const ua = navigator.userAgent;
  const match = ua.match(/\(([^)]+)\)/);
  return match ? match[1].split(";")[0].trim() : "Unknown device";
}

export async function isConfigured(): Promise<boolean> {
  const [pat, gists] = await Promise.all([getPat(), getRegisteredGists()]);
  return !!(pat && gists.length > 0);
}

async function getEncKey(salt: string): Promise<string> {
  const [passphrase, pat] = await Promise.all([getPassphrase(), getPat()]);
  const secret = passphrase ?? pat!;
  const key = await deriveKey(secret, salt);
  return keyToHex(key);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

export async function setupNewGist(pat: string): Promise<{ id: string; url: string }> {
  const salt = generateSaltHex();
  const deviceId = await getDeviceId();
  const deviceLabel = await getDeviceLabel();

  const manifest: GistManifest = {
    schema: 1,
    salt,
    devices: [{ id: deviceId, label: deviceLabel, pushedAt: new Date().toISOString() }],
  };

  const { id, url } = await createGist(pat, manifest);

  // Push initial state
  const encKey = await getEncKey(salt);
  const blob = await _api.sync.exportState(encKey, deviceId);
  await patchFiles(pat, id, {
    [`device-${deviceId}.b64`]: { filename: `device-${deviceId}.b64`, content: blob },
  });

  // Register and auto-select
  const existing = await getRegisteredGists();
  await saveRegisteredGists([...existing, { id, addedAt: new Date().toISOString() }]);
  if (!(await getImportSourceId())) await setImportSource(id);
  const exportIds = await getExportDestinationIds();
  if (!exportIds.includes(id)) await setExportDestinations([...exportIds, id]);

  return { id, url };
}

export async function linkExistingGist(pat: string, gistId: string): Promise<void> {
  await getManifest(pat, gistId); // validate accessible
  const existing = await getRegisteredGists();
  if (existing.find((g) => g.id === gistId)) return; // already registered
  await saveRegisteredGists([...existing, { id: gistId, addedAt: new Date().toISOString() }]);
  if (!(await getImportSourceId())) await setImportSource(gistId);
  const exportIds = await getExportDestinationIds();
  if (!exportIds.includes(gistId)) await setExportDestinations([...exportIds, gistId]);
}

export async function unlinkGist(gistId: string): Promise<void> {
  const gists = await getRegisteredGists();
  const remaining = gists.filter((g) => g.id !== gistId);
  await saveRegisteredGists(remaining);
  const [importSourceId, exportIds] = await Promise.all([
    getImportSourceId(),
    getExportDestinationIds(),
  ]);
  if (importSourceId === gistId)
    await _api.storage.set("importSourceId", remaining[0]?.id ?? null);
  await setExportDestinations(exportIds.filter((id) => id !== gistId));
}

export async function deleteGist(pat: string, gistId: string): Promise<void> {
  await deleteGistById(pat, gistId);
  await unlinkGist(gistId);
}

export async function removeDevice(pat: string, gistId: string, deviceId: string): Promise<void> {
  await deleteDeviceFile(pat, gistId, deviceId);
  const manifest = await getManifest(pat, gistId);
  const updated: GistManifest = {
    ...manifest,
    devices: manifest.devices.filter((d) => d.id !== deviceId),
  };
  await patchFiles(pat, gistId, {
    "manifest.json": { filename: "manifest.json", content: JSON.stringify(updated, null, 2) },
  });
}

// ─── Push — writes to all export destinations ─────────────────────────────────

export async function push(): Promise<void> {
  const [pat, exportIds] = await Promise.all([getPat(), getExportDestinationIds()]);
  if (!pat || exportIds.length === 0) return;

  const deviceId = await getDeviceId();
  const deviceLabel = await getDeviceLabel();
  const now = new Date().toISOString();

  await Promise.all(
    exportIds.map(async (gistId) => {
      const manifest = await getManifest(pat, gistId);
      const encKey = await getEncKey(manifest.salt);
      const blob = await _api.sync.exportState(encKey, deviceId);

      const existingDevice = manifest.devices.find((d) => d.id === deviceId);
      const updatedDevices: GistDevice[] = existingDevice
        ? manifest.devices.map((d) => (d.id === deviceId ? { ...d, pushedAt: now } : d))
        : [...manifest.devices, { id: deviceId, label: deviceLabel, pushedAt: now }];

      await patchFiles(pat, gistId, {
        [`device-${deviceId}.b64`]: { filename: `device-${deviceId}.b64`, content: blob },
        "manifest.json": {
          filename: "manifest.json",
          content: JSON.stringify({ ...manifest, devices: updatedDevices }, null, 2),
        },
      });
    }),
  );

  _lastSeenPushedAt[deviceId] = now;
}

// ─── Pull — reads from import source only ────────────────────────────────────

export async function pull(): Promise<boolean> {
  const [pat, importSourceId] = await Promise.all([getPat(), getImportSourceId()]);
  if (!pat || !importSourceId) return false;

  const deviceId = await getDeviceId();
  const manifest = await getManifest(pat, importSourceId);
  const encKey = await getEncKey(manifest.salt);

  const remoteDevices = manifest.devices.filter((d) => d.id !== deviceId);
  if (remoteDevices.length === 0) return false;

  const changedDevices = remoteDevices.filter((d) => d.pushedAt !== _lastSeenPushedAt[d.id]);
  if (changedDevices.length === 0) return false;

  const blobs = await getDeviceBlobs(pat, importSourceId, changedDevices.map((d) => d.id));
  if (blobs.length === 0) return false;

  await _api.sync.importStates(encKey, blobs);
  for (const d of changedDevices) _lastSeenPushedAt[d.id] = d.pushedAt;
  return true;
}

// ─── Sync cycle ───────────────────────────────────────────────────────────────

export async function syncNow(opts: { showProgress?: boolean } = {}): Promise<void> {
  if (!(await isConfigured())) return;

  let progress: ReturnType<typeof _api.notifications.progress> | null = null;
  if (opts.showProgress)
    progress = _api.notifications.progress("Syncing via GitHub Gist…", { indeterminate: true });

  try {
    await pull();
    await push();
    _consecutiveFailures = 0;
    if (_failureBannerId) { _failureBannerId.dismiss(); _failureBannerId = null; }
    if (progress) progress.finish("Gist sync complete");
    else if (opts.showProgress)
      _api.notifications.toast("Gist sync complete", { severity: "success" });
    await _api.storage.set("lastSync", new Date().toISOString());
  } catch (err) {
    if (progress) progress.error("Gist sync failed");
    _onSyncError(err);
  }
}

function _onSyncError(err: unknown) {
  _consecutiveFailures++;
  if (err instanceof GistApiError) {
    if (err.status === 401) {
      stopPoll();
      if (!_failureBannerId)
        _failureBannerId = _api.notifications.banner(
          "Gist Sync: GitHub PAT is invalid or expired",
          { severity: "error" },
        );
      return;
    }
    if (err.status === 404) {
      stopPoll();
      if (!_failureBannerId)
        _failureBannerId = _api.notifications.banner(
          "Gist Sync: Gist not found — re-configure in Settings",
          { severity: "error" },
        );
      return;
    }
  }
  if (_consecutiveFailures >= 3 && !_failureBannerId)
    _failureBannerId = _api.notifications.banner(
      `Gist Sync: repeated failures — ${err instanceof Error ? err.message : String(err)}`,
      { severity: "warning" },
    );
  else if (_consecutiveFailures < 3)
    _api.notifications.toast("Gist sync skipped — offline?", { severity: "warning" });
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

export function startPoll(intervalSeconds: number) {
  stopPoll();
  _pollInterval = setInterval(() => syncNow().catch(() => {}), intervalSeconds * 1000);
}

export function stopPoll() {
  if (_pollInterval !== null) { clearInterval(_pollInterval); _pollInterval = null; }
}
