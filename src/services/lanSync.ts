import { listen } from "@tauri-apps/api/event";
import { invoke } from "@/lib/invoke";
import { logFailure } from "@/lib/logger";
import { createSerialQueue } from "@/lib/serialQueue";
import { isServerMode } from "@/services/account";
import { entityClocks, type PeerInfo } from "@/services/lanSyncDevices";
import { ensureLanSyncIntro } from "@/services/lanSyncIntro";
import {
  exportLocalBlob,
  getDeviceId,
  mergeRemotePayload,
  onLocalMutation,
  openRemoteBlob,
  reloadAllStores,
  sessionBlobKeys,
  startRealtimeSync,
} from "@/services/sync";
import { getVaultKey } from "@/services/vault";
import { useLanSyncStore, type LanStatus } from "@/stores/lanSyncStore";
import { useVaultKeysStore } from "@/stores/vaultKeysStore";

const BROADCAST_DEBOUNCE_MS = 1000;

interface Session {
  selfId: string;
  keys: string[];
  seen: Set<string>;
  offs: Array<() => void>;
}

const store = () => useLanSyncStore.getState();
const fail = (context: string) => logFailure(`lan-sync ${context}`);
const keySigs = (keys: number[][]) => keys.map((k) => k.join(","));

const lifecycle = createSerialQueue();
const merges = createSerialQueue();
let session: Session | null = null;
let epoch = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let owed = false;

async function exportOwn(): Promise<number[]> {
  const blob = await exportLocalBlob();
  store().setLocalClocks(entityClocks(await openRemoteBlob(sessionBlobKeys(), blob)));
  return blob;
}

async function broadcastOwn(): Promise<void> {
  const blob = await exportOwn();
  if (!store().paused) await invoke("lan_sync_broadcast", { blob });
}

async function flush(): Promise<void> {
  if (flushing) {
    owed = true;
    return;
  }
  flushing = true;
  try {
    do {
      owed = false;
      await broadcastOwn().catch(fail("broadcast"));
    } while (owed && session);
  } finally {
    flushing = false;
  }
}

function requestBroadcast(): void {
  if (!session) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void flush();
  }, BROADCAST_DEBOUNCE_MS);
}

function clearPeers(): void {
  if (session) session.seen = new Set();
  store().setPeers([]);
}

function onPeers(s: Session, peers: PeerInfo[]): void {
  const others = peers.filter((p) => p.deviceId !== s.selfId);
  const { setPeers, rememberDevice } = store();
  setPeers(others);
  const arrived = others.filter((p) => !s.seen.has(p.deviceId));
  others.forEach(rememberDevice);
  s.seen = new Set(others.map((p) => p.deviceId));
  if (arrived.length > 0) requestBroadcast();
}

function onStatus(status: LanStatus): void {
  store().setStatus(status);
  if (status === "stopped") clearPeers();
}

function onBlobReady(deviceId: string): Promise<void> {
  return merges(async () => {
    store().markSyncing(deviceId, true);
    try {
      const blob = await invoke<number[] | null>("lan_sync_take_blob", { deviceId });
      if (!blob) return;
      const payload = await openRemoteBlob(sessionBlobKeys(), blob);
      if (!(await mergeRemotePayload(deviceId, payload))) return;
      await reloadAllStores();
      requestBroadcast();
    } finally {
      store().markSyncing(deviceId, false);
    }
  }).catch(fail(`blob from ${deviceId}`));
}

function onKeysChanged(): void {
  const s = session;
  if (!s || !getVaultKey()) return;
  if (keySigs(sessionBlobKeys()).every((k) => s.keys.includes(k))) return;
  const wanted = epoch;
  void lifecycle(() => begin(wanted)).catch(fail("restart"));
}

function detach(): void {
  session?.offs.forEach((off) => off());
  session = null;
  if (timer) clearTimeout(timer);
  timer = null;
}

async function begin(wanted: number): Promise<void> {
  if (wanted !== epoch) return;
  detach();
  const authKeys = sessionBlobKeys();
  if (!getVaultKey() || authKeys.length === 0) return;
  const [selfId, deviceName] = await Promise.all([
    getDeviceId(),
    invoke<string>("device_hostname").catch(() => ""),
  ]);
  const s: Session = { selfId, keys: keySigs(authKeys), seen: new Set(), offs: [] };
  session = s;
  s.offs = await Promise.all([
    listen<PeerInfo[]>("lan-sync://peers", (e) => onPeers(s, e.payload)),
    listen<{ deviceId: string }>("lan-sync://blob-ready", (e) => void onBlobReady(e.payload.deviceId)),
    listen<LanStatus>("lan-sync://status", (e) => onStatus(e.payload)),
  ]);
  s.offs.push(onLocalMutation(requestBroadcast), useVaultKeysStore.subscribe(onKeysChanged));
  await invoke("lan_sync_set_paused", { paused: store().paused });
  await invoke("lan_sync_start", { deviceId: selfId, deviceName, authKeys });
  void exportOwn().catch(fail("local clocks"));
}

async function end(): Promise<void> {
  detach();
  clearPeers();
  store().setStatus("stopped");
  await invoke("lan_sync_stop");
}

export async function startLanSync(): Promise<void> {
  const wanted = ++epoch;
  if (!getVaultKey() || !(await isServerMode())) return;
  await ensureLanSyncIntro();
  await lifecycle(() => begin(wanted));
}

export async function stopLanSync(): Promise<void> {
  epoch++;
  await lifecycle(end).catch(fail("stop"));
}

export async function setLanSyncPaused(paused: boolean): Promise<void> {
  store().setPaused(paused);
  await invoke("lan_sync_set_paused", { paused });
  if (!paused) requestBroadcast();
}

export function startSessionSync(): void {
  startRealtimeSync();
  startLanSync().catch(fail("start"));
}
