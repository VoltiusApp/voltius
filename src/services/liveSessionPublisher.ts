import { invoke } from "@tauri-apps/api/core";
import { buildManifest, type LiveSessionManifest } from "@/stores/liveSessionManifestCore";
import { useWorkspaceSnapshotStore, readWorkspaceSnapshot } from "@/stores/workspaceSnapshotStore";
import { useCrossDeviceSessionsStore } from "@/stores/crossDeviceSessionsStore";
import { getToggle } from "@/stores/toggleSettingsStore";
import { scheduleSync, syncNow } from "@/services/sync";

let deviceNameCache: string | null = null;

async function getDeviceName(): Promise<string> {
  if (deviceNameCache) return deviceNameCache;
  deviceNameCache = await invoke<string>("device_hostname").catch(() => "Unknown device");
  return deviceNameCache;
}

function buildCurrentManifest(deviceName: string): LiveSessionManifest | null {
  const deviceId = localStorage.getItem("voltius.device_id");
  if (!deviceId) return null;
  const snapshot = readWorkspaceSnapshot();
  // Toggle off → publish an empty session list (other devices stop offering
  // our sessions); tombstones still travel so closures propagate.
  const sessions = getToggle("cross-device-sessions") ? (snapshot?.sessions ?? []) : [];
  const store = useCrossDeviceSessionsStore.getState();
  store.ensureOpens(
    sessions.filter((s) => s.type === "ssh" && s.persist).map((s) => s.id),
  );
  return buildManifest({
    snapshotSessions: sessions,
    opens: useCrossDeviceSessionsStore.getState().opens,
    tombstones: store.tombstones,
    deviceId,
    deviceName,
  });
}

/** Structural signature: a change here is worth a push. cwd churn and the
 * updatedAt clock are excluded so we don't re-upload the blob constantly. */
function signature(m: LiveSessionManifest): string {
  return JSON.stringify({
    s: m.sessions.map((x): [string, string] => [x.id, x.openedAt]).sort(),
    c: m.closedSessions.map((x): [string, string] => [x.id, x.closedAt]).sort(),
  });
}

let lastSignature: string | null = null;

async function writeManifest(immediate: boolean): Promise<void> {
  const manifest = buildCurrentManifest(await getDeviceName());
  if (!manifest) return;
  const sig = signature(manifest);
  if (sig === lastSignature) return;
  lastSignature = sig;
  await invoke("live_sessions_save", { state: JSON.stringify(manifest) }).catch(() => {});
  if (immediate) syncNow(true).catch(() => {});
  else scheduleSync();
}

/** Un-debounced publish for close/ended events, where other devices must
 * learn about the tombstone as fast as possible. Fire-and-forget. */
export function publishLiveSessionsNow(): void {
  void writeManifest(true);
}

let started = false;

/** Mirror the workspace snapshot into live_sessions.json. Start AFTER the
 * launch-restore decision (same constraint as startWorkspaceSnapshotSync). */
export function startLiveSessionPublisher(): void {
  if (started) return;
  started = true;
  useWorkspaceSnapshotStore.subscribe(() => void writeManifest(false));
  useCrossDeviceSessionsStore.subscribe((s, prev) => {
    if (s.opens !== prev.opens || s.tombstones !== prev.tombstones) void writeManifest(false);
  });
  void writeManifest(false);
}
