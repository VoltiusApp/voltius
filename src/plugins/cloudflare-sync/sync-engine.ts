import type { PluginAPI } from "@/plugins/api";
import { generateSaltHex } from "./crypto";
import type { SyncStatus } from "./types";
import {
  WorkerApiError,
  deleteDevice,
  getDeviceBlobs,
  getManifest,
  getManifestWithEtag,
  isConflictStatus,
  putDeviceBlob,
  putManifest,
  type WorkerManifest,
} from "./worker-api";


export function normalizeWorkerUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("cloudflare-sync: Worker URL is required");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("cloudflare-sync: Worker URL is invalid");
  }
  const host = url.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("cloudflare-sync: Worker URL must use https:// (http:// only for localhost)");
  }
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

let _api: PluginAPI;
let _status: SyncStatus = "idle";
let _lastSync: Date | null = null;
let _error: string | null = null;
let _blobSizeBytes: number | null = null;
let _configured = false;
let _pollInterval: ReturnType<typeof setInterval> | null = null;
let _consecutiveFailures = 0;
let _failureBannerId: { dismiss(): void } | null = null;
/** deviceId → last known pushedAt (change detection for pull) */
let _lastSeenPushedAt: Record<string, string> = {};

export function getCloudflareSyncState() {
  return {
    status: _status,
    lastSync: _lastSync,
    error: _error,
    configured: _configured,
    blobSizeBytes: _blobSizeBytes,
  };
}

function publish() {
  _api.ui.publishState("sync-state", getCloudflareSyncState());
}

function setState(status: SyncStatus, error?: string) {
  _status = status;
  _error = error ?? null;
  if (status === "success") _lastSync = new Date();
  publish();
}

export function init(api: PluginAPI) {
  _api = api;
  publish();
  isConfigured()
    .then((c) => {
      _configured = c;
      publish();
    })
    .catch(() => {});
}

async function getWorkerUrl(): Promise<string | null> {
  return _api.storage.get<string>("workerUrl");
}

async function getToken(): Promise<string | null> {
  return _api.vault.get("syncToken");
}

async function getPassphrase(): Promise<string | null> {
  return _api.vault.get("passphrase");
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
  const [url, token, passphrase] = await Promise.all([
    getWorkerUrl(),
    getToken(),
    getPassphrase(),
  ]);
  return !!(url && token && passphrase);
}

async function getEncKey(salt: string): Promise<string> {
  const passphrase = await getPassphrase();
  if (!passphrase) {
    throw new Error("cloudflare-sync: passphrase is required (do not derive from the sync token)");
  }
  return _api.crypto.deriveKey(passphrase, salt);
}

async function requireConfig(): Promise<{ workerUrl: string; token: string }> {
  const [workerUrl, token] = await Promise.all([getWorkerUrl(), getToken()]);
  if (!workerUrl || !token) {
    throw new Error("cloudflare-sync: not configured");
  }
  return { workerUrl, token };
}

function markConfigured(value: boolean) {
  if (_configured === value) {
    publish();
    return;
  }
  _configured = value;
  publish();
}

/** Create a new remote vault (manifest + first device blob). */
export async function setupNewVault(
  workerUrl: string,
  token: string,
  passphrase: string,
  opts: { overwrite?: boolean } = {},
): Promise<void> {
  const normalized = normalizeWorkerUrl(workerUrl);
  if (!token.trim()) throw new Error("cloudflare-sync: sync token is required");
  if (!passphrase) throw new Error("cloudflare-sync: passphrase is required");

  let remoteExists = false;
  try {
    await getManifest(_api.http, normalized, token);
    remoteExists = true;
  } catch (err) {
    if (err instanceof WorkerApiError && err.status === 404) {
      remoteExists = false;
    } else {
      throw err;
    }
  }
  if (remoteExists && !opts.overwrite) {
    throw new Error(
      "cloudflare-sync: remote vault already exists — use Link existing, or confirm overwrite",
    );
  }

  await _api.storage.set("workerUrl", normalized);
  await _api.vault.set("syncToken", token);
  await _api.vault.set("passphrase", passphrase);

  const salt = generateSaltHex();
  const deviceId = await getDeviceId();
  const deviceLabel = await getDeviceLabel();
  const now = new Date().toISOString();
  const manifest: WorkerManifest = {
    schema: 1,
    salt,
    devices: [{ id: deviceId, label: deviceLabel, pushedAt: now }],
  };

  await putManifest(_api.http, normalized, token, manifest);
  const encKey = await getEncKey(salt);
  const blob = await _api.sync.exportState(encKey, deviceId);
  await putDeviceBlob(_api.http, normalized, token, deviceId, {
    content: blob,
    label: deviceLabel,
    pushedAt: now,
  });
  _lastSeenPushedAt[deviceId] = now;
  _blobSizeBytes = Math.round((blob.length * 3) / 4);
  markConfigured(true);
}

const WRONG_PASSPHRASE_MSG =
  "cloudflare-sync: passphrase does not match the remote vault — check it and try again";

async function restoreSecret(key: "syncToken" | "passphrase", previous: string | null): Promise<void> {
  if (previous === null) await _api.vault.delete(key);
  else await _api.vault.set(key, previous);
}

async function restoreStorage(key: string, previous: string | null): Promise<void> {
  if (previous === null) await _api.storage.delete(key);
  else await _api.storage.set(key, previous);
}

/** Link to an existing Worker vault.
 *  If the remote already has at least one device blob, the passphrase is probed
 *  (decrypt one blob) before we keep the new secrets. On failure we roll back
 *  any vault/storage writes so a bad passphrase is never left configured. */
export async function linkExistingVault(
  workerUrl: string,
  token: string,
  passphrase: string,
): Promise<void> {
  const normalized = normalizeWorkerUrl(workerUrl);
  if (!token.trim()) throw new Error("cloudflare-sync: sync token is required");
  if (!passphrase) throw new Error("cloudflare-sync: passphrase is required");
  const manifest = await getManifest(_api.http, normalized, token); // must exist

  const [prevUrl, prevToken, prevPass] = await Promise.all([
    _api.storage.get<string>("workerUrl"),
    _api.vault.get("syncToken"),
    _api.vault.get("passphrase"),
  ]);

  await _api.storage.set("workerUrl", normalized);
  await _api.vault.set("syncToken", token);
  await _api.vault.set("passphrase", passphrase);

  const rollback = async () => {
    await Promise.all([
      restoreStorage("workerUrl", prevUrl),
      restoreSecret("syncToken", prevToken),
      restoreSecret("passphrase", prevPass),
    ]);
    markConfigured(!!(prevUrl && prevToken && prevPass));
  };

  try {
    if (manifest.devices.length > 0) {
      const blobs = await getDeviceBlobs(
        _api.http,
        normalized,
        token,
        manifest.devices.map((d) => d.id),
      );
      if (blobs.length > 0) {
        const encKey = await getEncKey(manifest.salt);
        try {
          // importStates decrypts before merging — a wrong key throws and we roll back.
          await _api.sync.importStates(encKey, [blobs[0]]);
        } catch {
          throw new Error(WRONG_PASSPHRASE_MSG);
        }
      }
    }
    markConfigured(true);
  } catch (err) {
    await rollback();
    throw err;
  }
}

export async function disconnect(): Promise<void> {
  await Promise.all([
    _api.storage.delete("workerUrl"),
    _api.vault.delete("syncToken"),
    _api.vault.delete("passphrase"),
  ]);
  stopPoll();
  markConfigured(false);
  setState("idle");
}

export async function removeRemoteDevice(deviceId: string): Promise<void> {
  const { workerUrl, token } = await requireConfig();
  await deleteDevice(_api.http, workerUrl, token, deviceId);
  delete _lastSeenPushedAt[deviceId];
}

export async function push(): Promise<void> {
  const { workerUrl, token } = await requireConfig();
  if (!(await getPassphrase())) return;

  const deviceId = await getDeviceId();
  const deviceLabel = await getDeviceLabel();
  const now = new Date().toISOString();
  const { manifest, etag } = await getManifestWithEtag(_api.http, workerUrl, token);
  const encKey = await getEncKey(manifest.salt);
  const blob = await _api.sync.exportState(encKey, deviceId);

  // If-Match is the manifest ETag: device PUT RMW-updates manifest.devices[].
  await putDeviceBlob(_api.http, workerUrl, token, deviceId, {
    content: blob,
    label: deviceLabel,
    pushedAt: now,
  }, { ifMatch: etag });

  _blobSizeBytes = Math.round((blob.length * 3) / 4);
  _lastSeenPushedAt[deviceId] = now;
}

export async function pull(): Promise<boolean> {
  const { workerUrl, token } = await requireConfig();
  if (!(await getPassphrase())) return false;

  const deviceId = await getDeviceId();
  const manifest = await getManifest(_api.http, workerUrl, token);
  const encKey = await getEncKey(manifest.salt);

  const remoteDevices = manifest.devices.filter((d) => d.id !== deviceId);
  if (remoteDevices.length === 0) return false;

  const changedDevices = remoteDevices.filter((d) => d.pushedAt !== _lastSeenPushedAt[d.id]);
  if (changedDevices.length === 0) return false;

  const blobs = await getDeviceBlobs(
    _api.http,
    workerUrl,
    token,
    changedDevices.map((d) => d.id),
  );
  if (blobs.length === 0) return false;

  await _api.sync.importStates(encKey, blobs);
  for (const d of changedDevices) _lastSeenPushedAt[d.id] = d.pushedAt;
  return true;
}

/** Bounded pull+push retries when the Worker returns 412/409 (stale If-Match). */
export const MAX_SYNC_CONFLICT_RETRIES = 3;

export async function syncNow(opts: { showProgress?: boolean } = {}): Promise<void> {
  if (!(await isConfigured())) return;
  if (_status === "syncing") return;

  setState("syncing");

  let progress: ReturnType<typeof _api.notifications.progress> | null = null;
  if (opts.showProgress) {
    progress = _api.notifications.progress("Syncing via Cloudflare…", { indeterminate: true });
  }

  try {
    let lastConflict: unknown;
    for (let attempt = 0; attempt <= MAX_SYNC_CONFLICT_RETRIES; attempt++) {
      try {
        await pull();
        await push();
        lastConflict = null;
        break;
      } catch (err) {
        lastConflict = err;
        const conflict = err instanceof WorkerApiError && isConflictStatus(err.status);
        if (!conflict || attempt === MAX_SYNC_CONFLICT_RETRIES) throw err;
      }
    }
    if (lastConflict) throw lastConflict;
    _consecutiveFailures = 0;
    if (_failureBannerId) {
      _failureBannerId.dismiss();
      _failureBannerId = null;
    }
    if (progress) progress.finish("Cloudflare sync complete");
    else if (opts.showProgress) {
      _api.notifications.toast("Cloudflare sync complete", { severity: "success" });
    }
    await _api.storage.set("lastSync", new Date().toISOString());
    setState("success");
  } catch (err) {
    if (progress) progress.error("Cloudflare sync failed");
    onSyncError(err);
  }
}

function onSyncError(err: unknown) {
  _consecutiveFailures++;
  if (err instanceof WorkerApiError) {
    if (err.status === 401) {
      stopPoll();
      setState("error", "Sync token is invalid or expired");
      if (!_failureBannerId) {
        _failureBannerId = _api.notifications.banner(
          "Cloudflare Sync: sync token is invalid or expired",
          { severity: "error" },
        );
      }
      return;
    }
    if (isConflictStatus(err.status)) {
      setState("error", "Remote changed during sync — try again");
      return;
    }
    if (err.status === 404) {
      stopPoll();
      setState("error", "Vault not found — re-configure in Settings");
      if (!_failureBannerId) {
        _failureBannerId = _api.notifications.banner(
          "Cloudflare Sync: vault not found — re-configure in Settings",
          { severity: "error" },
        );
      }
      return;
    }
  }
  const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
  const msg = err instanceof Error ? err.message : String(err);
  setState(isOffline ? "offline" : "error", isOffline ? undefined : msg);
  if (_consecutiveFailures >= 3 && !_failureBannerId) {
    _failureBannerId = _api.notifications.banner(`Cloudflare Sync: repeated failures — ${msg}`, {
      severity: "warning",
    });
  } else if (_consecutiveFailures < 3) {
    _api.notifications.toast("Cloudflare sync skipped — offline?", { severity: "warning" });
  }
}

export function startPoll(intervalSeconds: number) {
  stopPoll();
  _pollInterval = setInterval(() => {
    void syncNow();
  }, intervalSeconds * 1000);
}

export function stopPoll() {
  if (_pollInterval !== null) {
    clearInterval(_pollInterval);
    _pollInterval = null;
  }
}
