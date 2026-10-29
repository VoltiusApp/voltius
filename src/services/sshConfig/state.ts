import { invoke } from "@/lib/invoke";
import { createSerialQueue } from "@/lib/serialQueue";
import { isServerMode } from "@/services/account";
import { scheduleSync } from "@/services/sync";
import { useSshConfigStore } from "@/stores/sshConfigStore";

export interface DevicePresence { present: boolean; hash: string; at: number; key?: string }
// `linked`: the connection existed before the sync took it over, so the sync detaches it instead of deleting it.
// `tombstoned`: `gone` was inferred from a connection tombstone, so the deleting computer's own record wins over it.
export interface ManagedEntry { alias: string; at: number; gone?: "detached" | "removed"; linked?: boolean; tombstoned?: boolean; devices: Record<string, DevicePresence> }
export interface SyncSwitch { on: boolean; vault: string; copyKeys?: boolean; at: number }

export interface SshConfigState {
  offer?: "accepted" | "declined";
  migrated?: Record<string, number>;
  notice?: "pending" | "seen";
  sync?: SyncSwitch;
  managed?: Record<string, ManagedEntry>;
  seen?: Record<string, number>;
  joined?: Record<string, number>;
  legacyAliases?: Record<string, string>;
}

export const presentAt = (hash: string, at: number, key?: string): DevicePresence => ({ present: true, hash, at, ...(key && { key }) });

export const REMOVED_TTL_MS = 30 * 24 * 3600 * 1000;
export const DEVICE_TTL_MS = 30 * 24 * 3600 * 1000;
export const SEEN_REFRESH_MS = 24 * 3600 * 1000;

// Each computer reviews its own config: a switch changed after a device joined waits for its review again.
export const joinedHere = (state: SshConfigState, device: string) => !!state.sync && (state.joined?.[device] ?? -Infinity) >= state.sync.at;

export const deviceAlive = (state: SshConfigState, device: string, now: number) => {
  const seen = state.seen?.[device];
  return seen === undefined || now - seen < DEVICE_TTL_MS;
};

const newer = <T extends { at: number }>(a: T | undefined, b: T | undefined) => (!a ? b : !b ? a : b.at > a.at ? b : a);

const objectOrEmpty = <T>(record: Record<string, T> | undefined): Record<string, T> => (record && typeof record === "object" ? record : {});

const objects = <T>(record: Record<string, T> | undefined): Record<string, T> =>
  Object.fromEntries(Object.entries(objectOrEmpty(record)).filter(([, v]) => v !== null && typeof v === "object"));

function latest(a: Record<string, number> | undefined, b: Record<string, number> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, at] of [...Object.entries(objectOrEmpty(a)), ...Object.entries(objectOrEmpty(b))]) {
    if (typeof at === "number" && at > (out[id] ?? -Infinity)) out[id] = at;
  }
  return out;
}

function mergeEntry(a: ManagedEntry | undefined, b: ManagedEntry | undefined): ManagedEntry {
  const newest = newer(a, b)!;
  const other = newest === a ? b : a;
  const head = newest.tombstoned && other?.gone === "removed" ? other : newest;
  const [da, db] = [objects(a?.devices), objects(b?.devices)];
  const devices: Record<string, DevicePresence> = {};
  for (const id of new Set([...Object.keys(da), ...Object.keys(db)])) devices[id] = newer(da[id], db[id])!;
  return { alias: head.alias, at: head.at, ...(head.gone && { gone: head.gone }), ...(head.tombstoned && { tombstoned: true }), ...((a?.linked || b?.linked) && { linked: true }), devices };
}

export function mergeSshConfigState(a: SshConfigState, b: SshConfigState, now = Date.now()): SshConfigState {
  const offer = a.offer ?? b.offer;
  const notice = a.notice === "seen" || b.notice === "seen" ? "seen" : a.notice ?? b.notice;
  const sync = newer(a.sync, b.sync);
  const [ma, mb] = [objects(a.managed), objects(b.managed)];
  const managed: Record<string, ManagedEntry> = {};
  for (const id of new Set([...Object.keys(ma), ...Object.keys(mb)])) {
    const e = mergeEntry(ma[id], mb[id]);
    if (e.gone !== "removed" || now - e.at < REMOVED_TTL_MS) managed[id] = e;
  }
  const seen = latest(a.seen, b.seen);
  const migrated = latest(a.migrated, b.migrated);
  const joined = latest(a.joined, b.joined);
  const legacyAliases = { ...b.legacyAliases, ...a.legacyAliases };
  return {
    ...(offer && { offer }),
    ...(Object.keys(migrated).length > 0 && { migrated }),
    ...(notice && { notice }),
    ...(sync && { sync }),
    ...(Object.keys(managed).length > 0 && { managed }),
    ...(Object.keys(seen).length > 0 && { seen }),
    ...(Object.keys(joined).length > 0 && { joined }),
    ...(Object.keys(legacyAliases).length > 0 && { legacyAliases }),
  };
}

function parse(raw: string | null | undefined): SshConfigState | null {
  try {
    const value = raw ? JSON.parse(raw) : null;
    return value && typeof value === "object" ? mergeSshConfigState(value as SshConfigState, {}) : null;
  } catch {
    return null;
  }
}

const publish = (state: SshConfigState) => {
  useSshConfigStore.getState().setState(state);
  return state;
};

export async function loadSshConfigState(): Promise<SshConfigState> {
  return publish(parse(await invoke<string | null>("ssh_config_state_load")) ?? {});
}

function write(state: SshConfigState): Promise<void> {
  return invoke("ssh_config_state_save", { state: JSON.stringify(state) });
}

const serialized = createSerialQueue();

export const updateSshConfigState = (patch: SshConfigState): Promise<SshConfigState> => serialized(async () => {
  const merged = mergeSshConfigState(patch, await loadSshConfigState());
  await write(merged);
  if (await isServerMode()) scheduleSync();
  return publish(merged);
});

export const applyRemoteSshConfigState = (raw: string | undefined): Promise<void> => serialized(async () => {
  const remote = parse(raw);
  if (!remote) return;
  const local = await loadSshConfigState();
  const merged = mergeSshConfigState(local, remote);
  if (JSON.stringify(merged) !== JSON.stringify(local)) await write(merged);
  publish(merged);
});
