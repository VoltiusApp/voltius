import { listen } from "@tauri-apps/api/event";
import { invoke } from "@/lib/invoke";
import i18n from "@/i18n";
import { logFailure } from "@/lib/logger";
import { createSerialQueue } from "@/lib/serialQueue";
import { settleWithin } from "@/lib/settleWithin";
import { getAccountId, isServerMode } from "@/services/account";
import { appToast } from "@/services/appToast";
import { isAlive } from "@/services/crdt";
import {
  createGroupIfNeeded,
  dropGroupSecrets,
  farewellSent,
  forgetMember,
  grantFor,
  holdsGroupSecrets,
  joinGroup,
  keyStillHeld,
  leaveGroup,
  localEntityCount,
  markLeft,
  markMoved,
  pairInfo,
  readFarewell,
  readGroup,
  replacedMember,
  retireDuplicateKeys,
  thisDevice,
  type Farewell,
  type GroupGrant,
  type JoinChoice,
  type LeaveReason,
} from "@/services/lanGroup";
import { entityClocks, type PeerInfo } from "@/services/lanSyncDevices";
import { startDeviceFiles, stopDeviceFiles } from "@/services/deviceFiles";
import { watchPeerAddresses } from "@/services/lanSyncAddresses";
import { ensureLanSyncIntro } from "@/services/lanSyncIntro";
import { whenLoginSyncSettled } from "@/services/loginSyncGate";
import {
  exportLocalBlob,
  mergeRemotePayload,
  onLocalMutation,
  openRemoteBlob,
  reloadAllStores,
  sessionBlobKeys,
  startRealtimeSync,
} from "@/services/sync";
import { getVaultKey } from "@/services/vault";
import { sameKey } from "@/services/vaultKeyCandidates";
import {
  IDLE_PAIRING,
  useLanSyncStore,
  type LanStatus,
  type PairRole,
  type Pairing,
  type Presence,
} from "@/stores/lanSyncStore";
import { useVaultKeysStore } from "@/stores/vaultKeysStore";
import { getPlatformSync } from "@/utils/platform";

const BROADCAST_DEBOUNCE_MS = 1000;
const STOP_WAIT_MS = 2000;
const LEAVE_PUSH_MS = 1000;

export interface LanMember {
  deviceId: string;
  deviceKey: string;
}

export type LanScope = {
  scope: string;
  authKeys: number[][];
  members?: LanMember[];
  farewell?: string;
  farewellLeft?: boolean;
} | null;
type Trust = NonNullable<LanScope>;

interface Resolved {
  trust: Trust;
  alive: string[];
}

interface Session extends Resolved {
  selfId: string;
  offs: Array<() => void>;
}

type PairEvent =
  | { state: "code"; sas: number; role: PairRole; peerId: string; peerKey: string; peerName: string; reverify?: boolean }
  | { state: "peerConfirmed" | "done" }
  | { state: "granted"; grant: GroupGrant }
  | { state: "ended" | "closed"; reason: string };

interface PairFlow {
  offs: Array<() => void>;
  confirmed: boolean;
  choice: JoinChoice;
}

const store = () => useLanSyncStore.getState();
const fail = (context: string) => logFailure(`lan-sync ${context}`);
const covers = (held: number[][], keys: number[][]) => keys.every((k) => held.some((h) => sameKey(h, k)));
const sameKeys = (a: number[][], b: number[][]) => a.length === b.length && covers(a, b);
const memberTag = (m: LanMember) => `${m.deviceId}:${m.deviceKey}`;
const sameMembers = (a: LanMember[] = [], b: LanMember[] = []) =>
  a.length === b.length && a.map(memberTag).every((tag) => b.some((m) => memberTag(m) === tag));
const sameLink = (a: Trust, b: Trust) =>
  a.scope === b.scope &&
  a.farewell === b.farewell &&
  a.farewellLeft === b.farewellLeft &&
  !a.members === !b.members &&
  sameKeys(a.authKeys, b.authKeys);
const owesFarewell = (f: Farewell | null): f is Farewell => !!f && (f.reason !== "left" || !!f.pending?.length);
const farewellTrust = (f: Farewell | null) =>
  owesFarewell(f) ? { farewell: f.secret, ...(f.reason === "left" ? { farewellLeft: true } : {}) } : {};
// Mirrors Rust `Kind`: a farewell manager neither listens nor advertises; only an account serves files and learns addresses.
const sayingFarewell = (t: Trust) => t.authKeys.length === 0 && !!t.farewell;
const onAccount = (t: Trust) => !t.members;

const lifecycle = createSerialQueue();
const merges = createSerialQueue();
let session: Session | null = null;
let epoch = 0;
let requested = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let owed = false;
let groupScope: string | null = null;
let flow: PairFlow | null = null;
let farewellDeferred = false;
let leaveChecked = false;
const pairSteps = createSerialQueue();
const windowSteps = createSerialQueue();

async function subscribe(offs: Array<() => void>, handlers: Record<string, (payload: never) => void>): Promise<void> {
  for (const [name, handle] of Object.entries(handlers)) {
    offs.push(await listen(`lan-sync://${name}`, (e) => handle(e.payload as never)));
  }
}

async function resolveScope(): Promise<Resolved | null> {
  if (await isServerMode()) {
    const [scope, farewell] = await Promise.all([getAccountId(), readFarewell().catch(() => null)]);
    const authKeys = sessionBlobKeys();
    if (!scope || authKeys.length === 0) return null;
    return { trust: { scope, authKeys, ...farewellTrust(farewell) }, alive: [] };
  }
  const group = await readGroup();
  if (!group) return farewellOnly();
  groupScope = group.groupId;
  const live = group.members.filter(isAlive);
  return {
    trust: {
      scope: group.groupId,
      authKeys: group.secrets.map((s) => s.secret),
      members: live.map((m) => ({ deviceId: m.id, deviceKey: m.device_key })),
    },
    alive: live.map((m) => m.id),
  };
}

// A device that left dials its members until each has heard it, or the key expires.
async function farewellOnly(): Promise<Resolved | null> {
  const farewell = await readFarewell().catch(() => null);
  if (farewell?.reason !== "left" || !farewell.group || !owesFarewell(farewell)) return null;
  return { trust: { scope: farewell.group, authKeys: [], members: [], ...farewellTrust(farewell) }, alive: [] };
}

export async function lanScope(): Promise<LanScope> {
  return (await resolveScope())?.trust ?? null;
}

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
      if (!s.trust.members) return;
      await retireDuplicateKeys().catch(fail("retire duplicate keys"));
      void restart().catch(fail("restart"));
    } finally {
      store().markSyncing(deviceId, false);
    }
  }).catch(fail(`blob from ${deviceId}`));
}

function onPresence(s: Session, { deviceId, state }: { deviceId: string; state: Presence | "left" }): void {
  if (state === "left") {
    if (s.alive.includes(deviceId)) void markLeft(deviceId).then(() => restart()).catch(fail("left"));
    return;
  }
  store().setPresence(deviceId, state);
  if (state === "moved" && s.alive.includes(deviceId)) void markMoved(deviceId).catch(fail("moved"));
}

function onKeysChanged(): void {
  const s = session;
  if (!s || s.trust.members || !getVaultKey() || covers(s.trust.authKeys, sessionBlobKeys())) return;
  void restart().catch(fail("restart"));
}

function restart(): Promise<void> {
  const wanted = epoch;
  return lifecycle(() => begin(wanted));
}

async function forgetPeer(deviceId: string, trust: Trust): Promise<void> {
  if (session) session.alive = session.alive.filter((id) => id !== deviceId);
  store().dropDevice(deviceId);
  if (!(await keyStillHeld(deviceId))) await invoke("lan_sync_forget", { deviceId, scope: trust.scope, group: !onAccount(trust) });
}

async function forgetDeparted(s: Session, next: Resolved | null): Promise<void> {
  if (!s.trust.members || !next || next.trust.scope !== s.trust.scope) return;
  for (const id of s.alive.filter((id) => !next.alive.includes(id))) {
    await forgetPeer(id, s.trust).catch(fail(`forget ${id}`));
  }
}

async function updateMembers(s: Session, next: Resolved): Promise<void> {
  const changed = !sameMembers(s.trust.members, next.trust.members);
  Object.assign(s, next);
  if (changed) await invoke("lan_sync_set_members", { members: next.trust.members });
}

function detach(): void {
  session?.offs.forEach((off) => off());
  session = null;
  if (timer) clearTimeout(timer);
  timer = null;
}

async function begin(wanted: number): Promise<void> {
  if (wanted !== epoch) return;
  const next = getVaultKey() ? await resolveScope() : null;
  if (next && sayingFarewell(next.trust) && flow) {
    farewellDeferred = true;
    return void (await stopFarewell());
  }
  const running = session;
  if (running) await forgetDeparted(running, next);
  if (running && next && sameLink(running.trust, next.trust)) return updateMembers(running, next);
  if (running && !next) return end();
  detach();
  if (!next) return;
  store().adoptScope(next.trust.scope);
  const me = await thisDevice();
  const s: Session = { selfId: me.id, ...next, offs: [] };
  session = s;
  try {
    await subscribe(s.offs, {
      peers: (peers: PeerInfo[]) => onPeers(s, peers),
      "blob-ready": ({ deviceId }: { deviceId: string }) => void onBlobReady(s, deviceId),
      status: sayingFarewell(next.trust) ? () => {} : onStatus,
      presence: (presence: { deviceId: string; state: Presence | "left" }) => onPresence(s, presence),
      rejected: ({ deviceId, reason }: { deviceId: string; reason: "keyChanged" }) => store().markRejected(deviceId, reason),
      "farewell-sent": ({ deviceId }: { deviceId: string }) => void farewellSent(deviceId).then(() => restart()).catch(fail("farewell")),
    });
    s.offs.push(onLocalMutation(requestBroadcast), useVaultKeysStore.subscribe(onKeysChanged));
    await invoke("lan_sync_set_paused", { paused: store().paused });
    pairingWindowLost();
    await invoke("lan_sync_start", { deviceId: me.id, deviceName: me.name, ...next.trust });
    if (onAccount(next.trust)) {
      startDeviceFiles().catch(fail("files start"));
      s.offs.push(watchPeerAddresses());
    } else {
      stopDeviceFiles().catch(fail("files stop"));
    }
  } catch (e) {
    detach();
    store().setStatus("stopped");
    throw e;
  }
  void flush();
}

// A farewell never runs beside a pairing window; it resumes once the window closes.
async function stopFarewell(): Promise<boolean> {
  if (!session || !sayingFarewell(session.trust)) return false;
  detach();
  await invoke("lan_sync_stop");
  return true;
}

async function end(): Promise<void> {
  detach();
  await merges(async () => {});
  clearPeers();
  store().setStatus("stopped");
  pairingWindowLost();
  await stopDeviceFiles();
  await invoke("lan_sync_stop");
}

export async function startLanSync(firstSync: Promise<unknown> = Promise.resolve()): Promise<void> {
  requested = true;
  const wanted = ++epoch;
  if (!getVaultKey()) return;
  if (!leaveChecked) {
    leaveChecked = true;
    await resumeLeave().catch(fail("resume leave"));
  }
  if (!(await lanScope())) return;
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
  leaveChecked = false;
  await halt();
}

const inBackground = () => getPlatformSync() === "android" && document.visibilityState === "hidden";

// Android keeps the process alive in the background; the multicast lock must not outlive the foreground.
// An open pairing sheet defers that until it closes, since a stop would drop its window.
function onVisibilityChange(): void {
  if (!requested || getPlatformSync() !== "android") return;
  if (!inBackground()) startLanSync().catch(fail("resume"));
  else if (!flow) void halt();
}

if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibilityChange);

export async function setLanSyncPaused(paused: boolean): Promise<void> {
  store().setPaused(paused);
  await invoke("lan_sync_set_paused", { paused });
  if (!paused) requestBroadcast();
}

export function startLanSyncInBackground(firstSync?: Promise<unknown>): void {
  startLanSync(firstSync).catch(fail("start"));
}

export function startSessionSync(firstSync?: Promise<unknown>): void {
  startRealtimeSync();
  startLanSyncInBackground(firstSync);
}

export async function clearLanSyncScopes(): Promise<void> {
  const scopes = [await getAccountId().catch(() => null), groupScope];
  groupScope = null;
  for (const scope of scopes) {
    if (scope) await invoke("lan_sync_clear_scope", { scope }).catch(fail("clear scope"));
  }
}

// On the lifecycle queue: a start that read the group before the forget must not list it after the block.
export function forgetDevice(deviceId: string): Promise<void> {
  return lifecycle(async () => {
    const trust = await lanScope();
    if (!trust) return store().dropDevice(deviceId);
    if (trust.members) await forgetMember(deviceId);
    await forgetPeer(deviceId, trust);
    if (trust.members && requested) await begin(epoch);
  });
}

export async function inLanGroup(): Promise<boolean> {
  return !!(await readGroup());
}

export async function leaveLanGroup(reason: LeaveReason = "account"): Promise<void> {
  const group = await readGroup();
  if (!group) return reason === "left" ? resumeLeave() : undefined;
  const linked = canPush();
  await leaveGroup(reason);
  await flush();
  if (reason === "left") await forgetLeftGroup(group.groupId, linked);
}

const canPush = () => !store().paused && store().peers.some((p) => store().presence[p.deviceId] !== "paused");

// A leave cut short by a failure or a quit still holds group secrets it can no longer use.
async function resumeLeave(): Promise<void> {
  if ((await isServerMode()) || (await readGroup())) return;
  const farewell = await readFarewell().catch(() => null);
  if (farewell?.reason === "left" && farewell.group && (await holdsGroupSecrets())) {
    await forgetLeftGroup(farewell.group, false);
  }
}

// The push has no ack, so the links get a moment to carry it before they close.
async function forgetLeftGroup(scope: string, linked: boolean): Promise<void> {
  if (linked) await new Promise((r) => setTimeout(r, LEAVE_PUSH_MS));
  await lifecycle(async () => {
    try {
      await end();
      await dropGroupSecrets();
      store().forgetAccount();
      if (!owesFarewell(await readFarewell().catch(() => null))) await invoke("lan_sync_clear_scope", { scope });
    } finally {
      if (requested) await begin(epoch).catch(fail("restart"));
    }
  });
}

function show(f: PairFlow, pairing: Pairing): void {
  if (flow === f) store().setPairing(pairing);
}

const showState = (f: PairFlow, state: Pairing["state"]) => show(f, { ...store().pairing, state });

function endPairing(f: PairFlow, reason: string, closed = false): void {
  f.confirmed = false;
  show(f, { state: "ended", reason, ...(closed ? { closed } : {}) });
}

const cancelSession = () => invoke("lan_sync_pair_cancel").catch(fail("pair cancel"));

const unsubscribe = (f: PairFlow) => f.offs.splice(0).forEach((off) => off());

function dropFlow(): void {
  if (flow) unsubscribe(flow);
  flow = null;
}

// Every lan_sync_start or lan_sync_stop drops an open pairing window.
function pairingWindowLost(): void {
  const { state, closed } = store().pairing;
  if (flow && state !== "done" && !closed) endPairing(flow, "stopped", true);
}

async function hostGrant(): Promise<GroupGrant> {
  const group = await createGroupIfNeeded();
  return grantFor(group, (await thisDevice()).name);
}

async function join(f: PairFlow, grant: GroupGrant): Promise<void> {
  show(f, { ...store().pairing, state: "joining", granted: true });
  try {
    await joinGroup(grant, f.choice);
  } catch (e) {
    fail("join")(e);
    return endPairing(f, "failed", true);
  }
  showState(f, "done");
  startLanSyncInBackground();
}

async function onPair(f: PairFlow, e: PairEvent): Promise<void> {
  if (flow !== f) return;
  switch (e.state) {
    case "code": {
      f.confirmed = false;
      const [entities, replaces] = await Promise.all([
        e.role === "joiner" && !e.reverify ? localEntityCount() : 0,
        replacedMember(e.peerId, e.peerKey),
      ]);
      const code: Pairing = { state: "code", sas: e.sas, role: e.role, peerName: e.peerName, peerHasData: entities > 0 };
      return show(f, replaces ? { ...code, replaces } : code);
    }
    case "peerConfirmed":
      if (!f.confirmed) showState(f, "peerConfirmed");
      return;
    case "granted":
      return join(f, e.grant);
    case "done":
      showState(f, "done");
      return startLanSyncInBackground();
    case "ended":
    case "closed":
      return endPairing(f, e.reason, e.state === "closed");
  }
}

export async function openPairing(): Promise<void> {
  dropFlow();
  const f: PairFlow = { offs: [], confirmed: false, choice: "combine" };
  flow = f;
  store().setPairing({ state: "searching" });
  await windowSteps(async () => {
    try {
      await ensureLanSyncIntro();
      await subscribe(f.offs, { pair: (e: PairEvent) => void pairSteps(() => onPair(f, e)).catch(fail("pair")) });
      const [me, info] = await Promise.all([thisDevice(), pairInfo()]);
      if (await lifecycle(stopFarewell)) farewellDeferred = true;
      if (flow === f) await invoke("lan_sync_pair_open", { deviceId: me.id, deviceName: me.name, info });
    } catch (e) {
      fail("pair open")(e);
      endPairing(f, "failed", true);
    }
    if (flow !== f) unsubscribe(f);
  });
}

export async function closePairing(): Promise<void> {
  dropFlow();
  store().setPairing(IDLE_PAIRING);
  await windowSteps(() => invoke("lan_sync_pair_close").catch(fail("pair close")));
  const resume = farewellDeferred;
  farewellDeferred = false;
  if (requested && inBackground()) await halt();
  else if (resume && requested) await restart();
}

export function confirmPairing(choice: JoinChoice = "combine"): Promise<void> {
  return pairSteps(async () => {
    const f = flow;
    const { state, role, peerHasData } = store().pairing;
    if (!f || f.confirmed || (state !== "code" && state !== "peerConfirmed")) return;
    f.confirmed = true;
    f.choice = peerHasData ? choice : "combine";
    showState(f, "joining");
    try {
      await invoke("lan_sync_pair_confirm", role === "host" ? { grant: await hostGrant() } : {});
    } catch (e) {
      fail("pair confirm")(e);
      endPairing(f, "failed");
      await cancelSession();
    }
  });
}

export async function cancelPairing(): Promise<void> {
  if (!flow || store().pairing.granted) return;
  endPairing(flow, "cancelled");
  await cancelSession();
}
