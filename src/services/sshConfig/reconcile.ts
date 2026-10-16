import type { Connection } from "@/types";
import { isTeamVaultId } from "@/stores/teamVaultMap";
import { driftOf, fingerprint, identityOf, type OwnedSnapshot } from "./hostFields";
import type { SshConfigHost } from "./parse";
import { deviceAlive, presentAt, REMOVED_TTL_MS, type ManagedEntry, type SshConfigState } from "./state";

export interface ReconcileInput {
  hosts: SshConfigHost[];
  all: SshConfigHost[];
  connections: (Pick<Connection, "id" | "vault_id" | "created_at"> & OwnedSnapshot)[];
  deleted: Record<string, string>;
  state: SshConfigState;
  device: string;
  now: number;
  deleteAllowed: boolean;
  rekey?: ReadonlySet<string>;
  unsynced?: ReadonlySet<string>;
}

export interface Reconcile {
  creates: SshConfigHost[];
  updates: { id: string; host: SshConfigHost; was?: string; identityChanged: boolean; drifted: boolean }[];
  deletes: string[];
  detachedToTeam: string[];
  detachedUnsynced: string[];
  detachedProxied: string[];
  held: SshConfigHost[];
  managed: Record<string, ManagedEntry>;
}

export function reconcile({ hosts, all, connections, deleted, state, device, now, deleteAllowed, rekey, unsynced }: ReconcileInput): Reconcile {
  const byId = new Map(connections.map((c) => [c.id, c]));
  const deletedAt = new Map(Object.entries(deleted));
  const unseen = new Set<string>();
  const table: Record<string, ManagedEntry> = { ...state.managed };
  const out: Reconcile = { creates: [], updates: [], deletes: [], detachedToTeam: [], detachedUnsynced: [], detachedProxied: [], held: [], managed: {} };
  const put = (id: string, e: ManagedEntry) => { table[id] = e; out.managed[id] = e; };
  const gone = (id: string, kind: "detached" | "removed") => put(id, { ...table[id], at: now, gone: kind });
  const presentOf = (devices: ManagedEntry["devices"]) => Object.entries(devices).filter(([d, p]) => p.present && (d === device || deviceAlive(state, d, now))).map(([, p]) => p);
  const anyPresent = (devices: ManagedEntry["devices"]) => presentOf(devices).length > 0;
  const proxied = new Set(all.filter((h) => h.proxyCommand).map((h) => h.alias));

  // A host that never reaches the other computers would hold its alias there forever.
  const othersSync = Object.keys(state.seen ?? {}).some((d) => d !== device && deviceAlive(state, d, now));
  for (const [id, e] of Object.entries(table)) {
    if (e.gone) continue;
    const c = byId.get(id);
    const personal = !!c && !isTeamVaultId(c.vault_id);
    const detachedAs = !personal ? undefined : othersSync && unsynced?.has(id) ? out.detachedUnsynced : proxied.has(e.alias) ? out.detachedProxied : undefined;
    if (detachedAs) {
      detachedAs.push(id);
      gone(id, "detached");
      continue;
    }
    if (personal) continue;
    if (!c && !deletedAt.has(id)) {
      unseen.add(id);
      continue;
    }
    if (c) {
      out.detachedToTeam.push(id);
      gone(id, "detached");
      continue;
    }
    // Past the removed-record TTL the deleter's record may be gone, so an old tombstone counts as the sync's delete.
    const expired = now - Date.parse(deletedAt.get(id)!) >= REMOVED_TTL_MS;
    put(id, { ...e, at: now, gone: !expired && anyPresent(e.devices) ? "detached" : "removed", tombstoned: true });
  }

  const liveFor = (alias: string) => Object.entries(table).filter(([id, e]) => !e.gone && e.alias === alias && !unseen.has(id));
  const held = (alias: string) => [...unseen].some((id) => table[id].alias === alias);
  for (const alias of new Set(Object.values(table).filter((e) => !e.gone).map((e) => e.alias))) {
    const dupes = liveFor(alias).sort(([a, ea], [b, eb]) => {
      if (!!ea.linked !== !!eb.linked) return ea.linked ? -1 : 1;
      const [ca, cb] = [byId.get(a)!.created_at, byId.get(b)!.created_at];
      return ca === cb ? (a < b ? -1 : 1) : ca < cb ? -1 : 1;
    });
    const [keep, ...rest] = dupes;
    if (rest.length === 0) continue;
    // The computers holding a dropped duplicate now hold the survivor, so it is not deleted while they still have the alias.
    const devices = { ...keep[1].devices };
    for (const [, e] of rest) for (const [d, p] of Object.entries(e.devices)) if (!devices[d] || p.at > devices[d].at) devices[d] = p;
    put(keep[0], { ...keep[1], devices });
    for (const [id, e] of rest) {
      if (e.linked) {
        gone(id, "detached");
        continue;
      }
      out.deletes.push(id);
      gone(id, "removed");
    }
  }

  const seen = new Set(all.map((h) => h.alias));
  const aliasOf = (id: string) => (table[id] && !table[id].gone ? table[id].alias : undefined);
  const blocked = (alias: string) => {
    const entries = Object.values(table).filter((e) => e.alias === alias);
    const newest = Math.max(...entries.map((e) => e.at));
    return entries.some((e) => e.at === newest && e.gone === "detached");
  };
  for (const host of hosts) {
    const [hit] = liveFor(host.alias);
    if (!hit) {
      if (held(host.alias)) out.held.push(host);
      else if (!blocked(host.alias)) out.creates.push(host);
      continue;
    }
    const [id, e] = hit;
    const mine = e.devices[device];
    const hash = fingerprint(host);
    const stale = !!host.identityFile && !!rekey?.has(id);
    const drifts = presentOf(e.devices).map((p) => driftOf(byId.get(id)!, p, all, aliasOf));
    const drifted = drifts.every((d) => d.length > 0);
    const keyDrifted = drifts.every((d) => d.includes("key"));
    if (mine?.present && mine.hash === hash && !stale && !drifted) continue;
    const identityChanged = stale || keyDrifted || !mine || identityOf(mine.hash) !== host.identityFile;
    out.updates.push({ id, host, was: mine?.hash, identityChanged, drifted });
    put(id, { ...e, devices: { ...e.devices, [device]: presentAt(hash, now, identityChanged ? undefined : mine?.key) } });
  }

  if (!deleteAllowed) return out;
  for (const [id, e] of Object.entries(table)) {
    const mine = e.devices[device];
    if (e.gone || seen.has(e.alias) || unseen.has(id)) continue;
    // A computer that never had the alias finishes a delete only once every record says absent, ignoring the 30-day TTL.
    const records = Object.values(e.devices);
    if (!mine?.present && (records.length === 0 || records.some((p) => p.present))) continue;
    const devices = mine?.present ? { ...e.devices, [device]: { ...mine, present: false, at: now } } : e.devices;
    if (anyPresent(devices)) {
      put(id, { ...e, devices });
    } else if (e.linked) {
      put(id, { ...e, devices, at: now, gone: "detached" });
    } else {
      out.deletes.push(id);
      put(id, { ...e, devices, at: now, gone: "removed" });
    }
  }
  return out;
}
