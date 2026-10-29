import { listen } from "@tauri-apps/api/event";
import { invoke } from "@/lib/invoke";
import i18n from "@/i18n";
import { logFailure } from "@/lib/logger";
import { createSerialQueue } from "@/lib/serialQueue";
import { settleWithin } from "@/lib/settleWithin";
import { isServerMode } from "@/services/account";
import { appToast } from "@/services/appToast";
import { entityClocks, type PeerInfo } from "@/services/lanSyncDevices";
import { ensureLanSyncIntro } from "@/services/lanSyncIntro";
import { whenLoginSyncSettled } from "@/services/loginSyncGate";
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
import { sameKey } from "@/services/vaultKeyCandidates";
import { useLanSyncStore, type LanStatus } from "@/stores/lanSyncStore";
import { useVaultKeysStore } from "@/stores/vaultKeysStore";
import { getPlatformSync } from "@/utils/platform";

const BROADCAST_DEBOUNCE_MS = 1000;
const STOP_WAIT_MS = 2000;

interface Session {
  selfId: string;
  keys: number[][];
  offs: Array<() => void>;
}

const store = () => useLanSyncStore.getState();
const fail = (context: string) => logFailure(`lan-sync ${context}`);
const covers = (held: number[][], keys: number[][]) => keys.every((k) => held.some((h) => sameKey(h, k)));

const lifecycle = createSerialQueue();
const merges = createSerialQueue();
let session: Session | null = null;
let epoch = 0;
let requested = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let owed = false;

async function broadcastOwn(): Promise<void> {
  if (store().paused || Object.keys(store().known).length === 0) return;
  const blob = await exportLocalBlob();
  store().setLocalClocks(entityClocks(await openRemoteBlob(sessionBlobKeys(), blob)));
  if (store().peers.length > 0) await invoke("lan_sync_broadcast", Uint8Array.from(blob));
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
  store().setPeers([]);
}

function announceNearby(peer: PeerInfo): void {
  appToast("info", i18n.t(`layout.sync.local.toast.${peer.route}`, { name: peer.deviceName }));
}

function onPeers(s: Session, peers: PeerInfo[]): void {
  const others = peers.filter((p) => p.deviceId !== s.selfId);
  const { setPeers, rememberDevice } = store();
  setPeers(others);
  others.filter(rememberDevice).forEach(announceNearby);
  if (others.length > 0) requestBroadcast();
}

function onStatus(status: LanStatus): void {
  store().setStatus(status);
  if (status === "stopped") clearPeers();
}

function onBlobReady(s: Session, deviceId: string): Promise<void> {
  return merges(async () => {
    if (session !== s) return;
    store().markSyncing(deviceId, true);
    try {
      const blob = await invoke<ArrayBuffer>("lan_sync_take_blob", { deviceId });
      if (blob.byteLength === 0) return;
      const payload = await openRemoteBlob(sessionBlobKeys(), Array.from(new Uint8Array(blob)));
      if (session !== s || !(await mergeRemotePayload(deviceId, payload))) return;
      await reloadAllStores();
      requestBroadcast();
    } finally {
      store().markSyncing(deviceId, false);
    }
  }).catch(fail(`blob from ${deviceId}`));
}

function onKeysChanged(): void {
  const s = session;
  if (!s || !getVaultKey() || covers(s.keys, sessionBlobKeys())) return;
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
  const authKeys = sessionBlobKeys();
  if (session && authKeys.length === session.keys.length && covers(session.keys, authKeys)) return;
  detach();
  if (!getVaultKey() || authKeys.length === 0) return;
  const [selfId, deviceName] = await Promise.all([
    getDeviceId(),
    invoke<string>("device_hostname").catch(() => ""),
  ]);
  const s: Session = { selfId, keys: authKeys, offs: [] };
  session = s;
  try {
    s.offs.push(await listen<PeerInfo[]>("lan-sync://peers", (e) => onPeers(s, e.payload)));
    s.offs.push(await listen<{ deviceId: string }>("lan-sync://blob-ready", (e) => void onBlobReady(s, e.payload.deviceId)));
    s.offs.push(await listen<LanStatus>("lan-sync://status", (e) => onStatus(e.payload)));
    s.offs.push(onLocalMutation(requestBroadcast), useVaultKeysStore.subscribe(onKeysChanged));
    await invoke("lan_sync_set_paused", { paused: store().paused });
    await invoke("lan_sync_start", { deviceId: selfId, deviceName, authKeys });
  } catch (e) {
    detach();
    store().setStatus("stopped");
    throw e;
  }
  void flush();
}

async function end(): Promise<void> {
  detach();
  await merges(async () => {});
  clearPeers();
  store().setStatus("stopped");
  await invoke("lan_sync_stop");
}

export async function startLanSync(firstSync: Promise<unknown> = Promise.resolve()): Promise<void> {
  requested = true;
  const wanted = ++epoch;
  if (!getVaultKey() || !(await isServerMode())) return;
  await ensureLanSyncIntro();
  await Promise.all([whenLoginSyncSettled(), firstSync.catch(() => {})]);
  await lifecycle(() => begin(wanted));
}

// Bounded: a vault lock or account switch must never wait on a stuck start.
async function halt(): Promise<void> {
  epoch++;
  const stopped = lifecycle(end).catch(fail("stop")).then(() => true);
  if (!(await settleWithin(stopped, STOP_WAIT_MS, false))) fail("stop")("still waiting on start");
}

export async function stopLanSync(): Promise<void> {
  requested = false;
  await halt();
}

// Android keeps the process alive in the background; the multicast lock must not outlive the foreground.
function onVisibilityChange(): void {
  if (!requested || getPlatformSync() !== "android") return;
  if (document.visibilityState === "hidden") void halt();
  else startLanSync().catch(fail("resume"));
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);

export async function setLanSyncPaused(paused: boolean): Promise<void> {
  store().setPaused(paused);
  await invoke("lan_sync_set_paused", { paused });
  if (!paused) requestBroadcast();
}

export function startSessionSync(firstSync?: Promise<unknown>): void {
  startRealtimeSync();
  startLanSync(firstSync).catch(fail("start"));
}
