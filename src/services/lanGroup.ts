import { invoke } from "@/lib/invoke";
import { logFailure } from "@/lib/logger";
import { createSerialQueue } from "@/lib/serialQueue";
import i18n from "@/i18n";
import { adoptVaultKey, getAccountMode, randomVaultKey } from "@/services/account";
import { isAlive } from "@/services/crdt";
import {
  ENTITY_FILES,
  getDeviceId,
  importMergedPayload,
  mergeBlobPayload,
  mergeRemotePayload,
  parseEntities,
  reloadAllStores,
  replaceWithPayloads,
  scheduleSync,
  serialMerge,
  type BlobPayload,
} from "@/services/sync";
import { getVaultKey, unlockVaultIfNeeded } from "@/services/vault";
import { bytesToHex, hexToBytes } from "@/utils/base64";
import { getPlatformSync } from "@/utils/platform";
import { isNoAccountMode, type NoAccountMode } from "@/utils/accountMode";
import { LAN_FAREWELL_ENTRY as FAREWELL_ENTRY } from "@/services/accountCacheKeys";

export const LAN_GROUP_FILE = "lan_group.json";
export const MAX_GROUP_EPOCHS = 16;
const MAX_HOST_NAME_BYTES = 128;
const SECRET_PREFIX = "lan-group-secret:";
const FAREWELL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const farewellWrites = createSerialQueue();

export interface GroupGrant {
  groupId: string;
  vaultKey: string;
  secrets: { epoch: number; secret: string }[];
  hostName: string;
}

interface Stamped {
  updated_at: string;
  deleted_at?: string;
  clocks: Record<string, string>;
}

export interface GroupMember extends Stamped {
  id: string;
  kind: "member";
  name: string;
  platform: string;
  device_key: string;
  joined_at: string;
  moved_at?: string;
}

export interface GroupMeta extends Stamped {
  id: "group";
  kind: "group";
  group_id: string;
}

type GroupEntity = GroupMember | GroupMeta;

export interface EpochSecret {
  epoch: number;
  secret: number[];
}

export interface GroupState {
  groupId: string;
  members: GroupMember[];
  secrets: EpochSecret[];
}

export type JoinChoice = "combine" | "replace";

export type LeaveReason = "account" | "left";

export interface Farewell {
  secret: string;
  reason: LeaveReason;
  group?: string;
  pending?: string[];
}

type KeptFarewell = Farewell & { at: string };

export interface PairInfo {
  mode: "none" | "account";
  group: string | null;
  entities: number;
  members: number;
}

const secretName = (epoch: number) => `${SECRET_PREFIX}${epoch}`;

async function requireNoAccount(): Promise<NoAccountMode> {
  const mode = await getAccountMode();
  if (!isNoAccountMode(mode)) throw new Error(`lan group needs a no-account vault, not "${mode}"`);
  return mode;
}

function epochsOf(secrets: Record<string, string>): EpochSecret[] {
  return Object.entries(secrets)
    .filter(([name, secret]) => name.startsWith(SECRET_PREFIX) && /^[0-9a-f]{64}$/i.test(secret))
    .map(([name, secret]) => ({ epoch: Number(name.slice(SECRET_PREFIX.length)), secret: hexToBytes(secret) }))
    .filter(({ epoch }) => Number.isSafeInteger(epoch) && epoch > 0)
    .sort((a, b) => b.epoch - a.epoch);
}

function groupIn(payload: BlobPayload, selfId: string): GroupState | null {
  const entities = parseEntities(payload.files[LAN_GROUP_FILE]) as unknown as GroupEntity[];
  const meta = entities.find((e): e is GroupMeta => e.kind === "group" && isAlive(e));
  const members = entities.filter((e): e is GroupMember => e.kind === "member");
  const self = members.find((m) => m.id === selfId);
  if (!meta || !self || !isAlive(self) || self.moved_at) return null;
  return { groupId: meta.group_id, members, secrets: epochsOf(payload.secrets).slice(0, MAX_GROUP_EPOCHS) };
}

async function currentGroup() {
  await unlockVaultIfNeeded();
  const [payload, selfId] = await Promise.all([invoke<BlobPayload>("state_export_raw"), getDeviceId()]);
  return { payload, selfId, group: groupIn(payload, selfId) };
}

export async function readGroup(): Promise<GroupState | null> {
  return (await currentGroup()).group;
}

function edit<T extends GroupEntity>(entity: Pick<T, "id"> & Partial<T>, changes: Partial<T>, at: string): T {
  const clocks = { ...entity.clocks };
  for (const field of Object.keys(changes)) clocks[field === "deleted_at" ? "__deleted__" : field] = at;
  return { ...entity, ...changes, updated_at: at, clocks } as T;
}

// A null secret is a tombstone, which every member merges and keeps.
async function writeGroup(
  entities: GroupEntity[],
  secrets: Record<string, string | null>,
  at: string,
  secretClocks: Record<string, string> = {},
): Promise<void> {
  const patch: BlobPayload = {
    files: { [LAN_GROUP_FILE]: JSON.stringify(entities) },
    secrets: Object.fromEntries(Object.entries(secrets).filter((e): e is [string, string] => e[1] !== null)),
    secret_clocks: Object.fromEntries(Object.keys(secrets).map((name) => [name, secretClocks[name] ?? at])),
  };
  await unlockVaultIfNeeded();
  await serialMerge(async () => {
    const local = await invoke<BlobPayload>("state_export_raw");
    await importMergedPayload(mergeBlobPayload(local, patch).payload);
  });
  scheduleSync();
}

type Identity = Pick<GroupMember, "id" | "name" | "platform" | "device_key">;

export async function thisDevice(): Promise<Pick<GroupMember, "id" | "name">> {
  const [id, name] = await Promise.all([getDeviceId(), invoke<string>("device_hostname").catch(() => "")]);
  return { id, name };
}

async function identity(): Promise<Identity> {
  const [device, device_key] = await Promise.all([thisDevice(), invoke<string>("lan_sync_device_key")]);
  return { ...device, platform: getPlatformSync() ?? "", device_key };
}

const tombstoned = (m: GroupMember, at: string) => edit(m, { deleted_at: at }, at);
const retiredAtOwnClock = (m: GroupMember) => tombstoned(m, m.updated_at);

// A secret tombstone on its value's own clock loses the tie, so it takes the next millisecond.
function justAfter(clock: string | undefined): string | undefined {
  const t = Date.parse(clock ?? "");
  return Number.isNaN(t) ? undefined : new Date(t + 1).toISOString();
}

/** Drops of group secrets held in `before`, each dated just after its own clock. */
function droppedSecrets(before: BlobPayload, keep: Record<string, string>, at: string) {
  const names = Object.keys(before.secrets).filter((name) => name.startsWith(SECRET_PREFIX) && !(name in keep));
  return {
    secrets: Object.fromEntries(names.map((name) => [name, null])),
    clocks: Object.fromEntries(names.map((name) => [name, justAfter(before.secret_clocks?.[name]) ?? at])),
  };
}

// `before` is local state ahead of the join. A group left earlier is retired at its own clocks,
// so a device that is also in the new group keeps every newer write it made there.
async function enterGroup(me: Identity, groupId: string, secrets: Record<string, string>, before: BlobPayload): Promise<void> {
  const at = new Date().toISOString();
  const old = parseEntities(before.files[LAN_GROUP_FILE]) as unknown as GroupEntity[];
  const otherGroup = !old.some((e) => e.kind === "group" && e.group_id === groupId);
  const onlyIfOther = <T,>(items: T[]) => (otherGroup ? items : []);
  const stale = onlyIfOther(old.filter((e): e is GroupMember => e.kind === "member" && e.id !== me.id && isAlive(e)));
  const dropped = otherGroup ? droppedSecrets(before, secrets, at) : { secrets: {}, clocks: {} };
  await writeGroup(
    [
      edit<GroupMeta>({ id: "group" }, { kind: "group", group_id: groupId }, at),
      edit<GroupMember>({ id: me.id }, { ...me, kind: "member", joined_at: at, moved_at: "" }, at),
      ...stale.map(retiredAtOwnClock),
    ],
    { ...secrets, ...dropped.secrets },
    at,
    dropped.clocks,
  );
  const left = await readKeptFarewell().catch(() => null);
  await invoke("keychain_delete", { key: FAREWELL_ENTRY }).catch(logFailure("lan group farewell"));
  if (left) await releaseLeftScope(left);
}

export async function createGroupIfNeeded(): Promise<GroupState> {
  const { payload, group: existing } = await currentGroup();
  if (existing) return existing;
  const mode = await requireNoAccount();
  const me = await identity();
  if (mode === "local") await adoptVaultKey(randomVaultKey());
  await enterGroup(me, crypto.randomUUID(), { [secretName(1)]: bytesToHex(randomVaultKey()) }, payload);
  const group = await readGroup();
  if (!group) throw new Error("lan group was not written");
  return group;
}

function truncateUtf8(text: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  let out = "";
  let used = 0;
  for (const ch of text) {
    used += encoder.encode(ch).length;
    if (used > maxBytes) break;
    out += ch;
  }
  return out;
}

export async function grantFor(group: GroupState, hostName: string): Promise<GroupGrant> {
  const key = getVaultKey();
  if (!key) throw new Error(i18n.t("common.error.vaultLocked"));
  return {
    groupId: group.groupId,
    vaultKey: bytesToHex(key),
    secrets: group.secrets.map(({ epoch, secret }) => ({ epoch, secret: bytesToHex(secret) })),
    hostName: truncateUtf8(hostName, MAX_HOST_NAME_BYTES),
  };
}

/** The vault moves to the group key first, so a failure leaves it on whichever key the keychain holds. */
export async function joinGroup(grant: GroupGrant, choice: JoinChoice, host?: [deviceId: string, payload: BlobPayload]): Promise<void> {
  await requireNoAccount();
  const { payload: before, group } = await currentGroup();
  if (group && group.groupId !== grant.groupId) throw new Error(`already in lan group ${group.groupId}`);
  const secrets = group ? unheldSecrets(group, grant) : grant.secrets;
  const me = await identity();
  await adoptVaultKey(hexToBytes(grant.vaultKey));
  if (choice === "replace") await replaceWithPayloads(host ? [host] : []);
  else if (host && (await mergeRemotePayload(...host))) await reloadAllStores();
  await enterGroup(
    me,
    grant.groupId,
    Object.fromEntries(secrets.map(({ epoch, secret }) => [secretName(epoch), secret.toLowerCase()])),
    before,
  );
  await retireDuplicateKeys();
}

/** A grant for the group we are in must carry its vault key and agree on every epoch we hold. */
function unheldSecrets(group: GroupState, grant: GroupGrant): GroupGrant["secrets"] {
  const key = getVaultKey();
  if (!key || bytesToHex(key) !== grant.vaultKey.toLowerCase()) throw new Error("lan group grant carries another vault key");
  const held = new Map(group.secrets.map(({ epoch, secret }) => [epoch, bytesToHex(secret)]));
  if (grant.secrets.some(({ epoch, secret }) => held.has(epoch) && held.get(epoch) !== secret.toLowerCase())) {
    throw new Error("lan group grant disagrees with an epoch secret");
  }
  return grant.secrets.filter(({ epoch }) => !held.has(epoch));
}

const joinedLater = (a: GroupMember, b: GroupMember) => a.joined_at > b.joined_at || (a.joined_at === b.joined_at && a.id > b.id);

/** One key, one member: of live members sharing a device key, only the latest to join stays. */
export async function retireDuplicateKeys(): Promise<void> {
  const group = await readGroup();
  const live = group?.members.filter(isAlive) ?? [];
  const stale = live.filter((m) => live.some((o) => o.device_key === m.device_key && joinedLater(o, m)));
  if (stale.length > 0) await writeGroup(stale.map(retiredAtOwnClock), {}, new Date().toISOString());
}

/** Whether a live member other than `deviceId` holds the key `deviceId` was listed with. */
export async function keyStillHeld(deviceId: string): Promise<boolean> {
  const members = (await readGroup())?.members ?? [];
  const key = members.find((m) => m.id === deviceId)?.device_key;
  return !!key && members.some((m) => m.id !== deviceId && isAlive(m) && m.device_key === key);
}

export async function forgetMember(deviceId: string): Promise<void> {
  const { payload, selfId, group } = await currentGroup();
  const member = group?.members.find((m) => m.id === deviceId);
  if (!member || !isAlive(member) || deviceId === selfId) return;
  const at = new Date().toISOString();
  const epochs = epochsOf(payload.secrets);
  const secrets: Record<string, string | null> = { [secretName((epochs[0]?.epoch ?? 0) + 1)]: bytesToHex(randomVaultKey()) };
  for (const { epoch } of epochs.slice(MAX_GROUP_EPOCHS - 1)) secrets[secretName(epoch)] = null;
  await writeGroup([tombstoned(member, at)], secrets, at);
}

const departed = (member: GroupMember, reason: LeaveReason, at: string) =>
  reason === "left" ? tombstoned(member, at) : edit(member, { moved_at: at }, at);

/**
 * Marks this device departed; its newest secret stays behind as the farewell key.
 * Every other live member is owed a farewell until it is heard, so a leave cut short still delivers.
 */
export async function leaveGroup(reason: LeaveReason): Promise<void> {
  const { selfId, group } = await currentGroup();
  const self = group?.members.find((m) => m.id === selfId);
  if (!group || !self) return;
  const at = new Date().toISOString();
  if (group.secrets[0]) {
    const others = group.members.filter((m) => m.id !== selfId && isAlive(m) && !m.moved_at).map((m) => m.id);
    const pending = reason === "left" ? { pending: others } : {};
    await keepFarewell({ secret: bytesToHex(group.secrets[0].secret), at, reason, group: group.groupId, ...pending });
  }
  await writeGroup([departed(self, reason, at)], {}, at);
}

export async function holdsGroupSecrets(): Promise<boolean> {
  return epochsOf((await currentGroup()).payload.secrets).length > 0;
}

/** Never while linked to the group: members would merge these drops and lose their keys. */
export async function dropGroupSecrets(): Promise<void> {
  const { payload } = await currentGroup();
  const at = new Date().toISOString();
  const dropped = droppedSecrets(payload, {}, at);
  if (Object.keys(dropped.secrets).length > 0) await writeGroup([], dropped.secrets, at, dropped.clocks);
}

async function liveMember(deviceId: string): Promise<GroupMember | undefined> {
  const { selfId, group } = await currentGroup();
  return group?.members.find((m) => m.id === deviceId && m.id !== selfId && isAlive(m));
}

// Only a live member: editing a tombstoned one would revive it.
async function markDeparted(deviceId: string, reason: LeaveReason): Promise<void> {
  const member = await liveMember(deviceId);
  if (!member || (reason === "account" && member.moved_at)) return;
  const at = new Date().toISOString();
  await writeGroup([departed(member, reason, at)], {}, at);
}

export const markMoved = (deviceId: string) => markDeparted(deviceId, "account");
export const markLeft = (deviceId: string) => markDeparted(deviceId, "left");

/** The member a pairing would take over: a device id this group knows under another key. */
export async function replacedMember(deviceId: string, deviceKey: string): Promise<string | undefined> {
  const member = (await readGroup())?.members.find((m) => m.id === deviceId);
  return member && member.device_key !== deviceKey ? member.name : undefined;
}

function parseFarewell(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) ?? {};
  } catch {
    return {};
  }
}

// A left group's peer file holds the addresses its farewell dials, so it goes only once that farewell is over.
async function releaseLeftScope({ reason, group }: { reason?: unknown; group?: unknown }): Promise<void> {
  if (reason !== "left" || typeof group !== "string") return;
  await invoke("lan_sync_clear_scope", { scope: group }).catch(logFailure("lan group scope"));
}

async function keepFarewell(kept: KeptFarewell): Promise<void> {
  await invoke("keychain_set", { key: FAREWELL_ENTRY, value: JSON.stringify(kept) });
}

async function readKeptFarewell(): Promise<KeptFarewell | null> {
  const raw = await invoke<string | null>("keychain_get", { key: FAREWELL_ENTRY });
  if (!raw) return null;
  const { secret, at, reason, group, pending } = parseFarewell(raw);
  if (typeof secret === "string" && Date.now() - Date.parse(String(at)) < FAREWELL_TTL_MS) {
    return {
      secret,
      at: String(at),
      reason: reason === "left" ? "left" : "account",
      ...(typeof group === "string" ? { group } : {}),
      ...(Array.isArray(pending) ? { pending: pending.filter((id): id is string => typeof id === "string") } : {}),
    };
  }
  await invoke("keychain_delete", { key: FAREWELL_ENTRY });
  await releaseLeftScope({ reason, group });
  return null;
}

export async function readFarewell(): Promise<Farewell | null> {
  const kept = await readKeptFarewell();
  if (!kept) return null;
  const { at: _at, ...farewell } = kept;
  return farewell;
}

/** A device that has heard this device's farewell needs no other. */
export function farewellSent(deviceId: string): Promise<void> {
  return farewellWrites(async () => {
    const kept = await readKeptFarewell();
    if (!kept?.pending?.includes(deviceId)) return;
    const pending = kept.pending.filter((id) => id !== deviceId);
    await keepFarewell({ ...kept, pending });
    if (pending.length === 0) await releaseLeftScope(kept);
  });
}

function entityCount(payload: BlobPayload): number {
  return ENTITY_FILES.filter((f) => f !== LAN_GROUP_FILE)
    .reduce((n, f) => n + parseEntities(payload.files[f]).filter(isAlive).length, 0);
}

export async function localEntityCount(): Promise<number> {
  return entityCount((await currentGroup()).payload);
}

export async function pairInfo(): Promise<PairInfo> {
  const [mode, { payload, group }] = await Promise.all([getAccountMode(), currentGroup()]);
  return {
    mode: isNoAccountMode(mode) ? "none" : "account",
    group: group?.groupId ?? null,
    entities: entityCount(payload),
    members: group?.members.filter(isAlive).length ?? 0,
  };
}
