import * as connApi from "@/services/connections";
import { listIdentities } from "@/services/identities";
import { PERSONAL_VAULT } from "@/services/vaultLookup";
import { findDupes } from "@/services/import-export/context";
import { parseOpensshFiles, readOpensshFiles } from "@/services/import-export/parsers/openssh";
import { importCtxOf, reloadKeys } from "@/services/import-export/storeAccess";
import { isTeamVaultId } from "@/stores/teamVaultMap";
import { getDeviceId } from "@/services/sync";
import type { Connection, Identity } from "@/types";
import { baseName, identityPaths, keyExportsOf, splitSupported, targetOf, type SkippedAlias } from "./hostFields";
import type { SshConfigHost } from "./parse";
import { loadSshConfigState, presentAt, updateSshConfigState, type ManagedEntry, type SshConfigState, type SyncSwitch } from "./state";
import { sshConfigSync } from "./sync";

export type LinkReason = "legacy" | "detached" | "name" | "address";
export type HostRow =
  | { kind: "create"; alias: string; target: string }
  | { kind: "link"; alias: string; target: string; reason: LinkReason; connectionId: string; connectionName: string; identityName?: string }
  | { kind: "ambiguous"; alias: string; target: string; candidates: string[] }
  | { kind: "skipped"; alias: string; target: string; reason: SkippedAlias["reason"] }
  | { kind: "managed"; alias: string; target: string; connectionName: string }
  | { kind: "detached"; alias: string; target: string; connectionId: string; connectionName: string; deleted: boolean };
export interface ActivationChoice { links: { alias: string; connectionId: string }[]; ignored: { alias: string; connectionId: string }[]; creates: string[] }
export type KeyState = "copy" | "notCopied" | "exists" | "unreadable";
export interface KeyRow { name: string; path: string; state: Record<"copy" | "ref", KeyState> }

const linkable = (c: Connection) => !isTeamVaultId(c.vault_id) && (c.connection_type ?? "ssh") === "ssh";
const sameAddress = (c: Connection, h: SshConfigHost) => c.host === h.hostname && c.port === h.port && (c.username ?? "") === (h.user ?? "");

type IdentityLabel = Pick<Identity, "id" | "name" | "username">;

export function planRows(hosts: SshConfigHost[], skipped: SkippedAlias[], connections: Connection[], state: SshConfigState, mode: "activate" | "review", identities: IdentityLabel[] = []): HostRow[] {
  const managed = state.managed ?? {};
  const byId = new Map(connections.map((c) => [c.id, c]));
  const nameOf = (id: string) => byId.get(id)?.name || byId.get(id)?.host || id;
  const skippedRows: HostRow[] = skipped.map((s) => ({ kind: "skipped", alias: s.alias, target: s.target, reason: s.reason }));

  const entriesOf = (h: SshConfigHost) => Object.entries(managed).filter(([, e]) => e.alias === h.alias);
  const followRow = (h: SshConfigHost): HostRow | undefined => {
    const mine = entriesOf(h);
    const live = mine.find(([id, e]) => !e.gone && byId.has(id));
    if (live) return { kind: "managed", alias: h.alias, target: targetOf(h), connectionName: nameOf(live[0]) };
    if (mine.some(([id, e]) => !e.gone && !byId.has(id))) return { kind: "skipped", alias: h.alias, target: targetOf(h), reason: "pending" };
    return undefined;
  };

  if (mode === "review") {
    const rows = hosts.flatMap((h): HostRow[] => {
      const follows = followRow(h);
      if (follows) return [follows];
      const detached = entriesOf(h).filter(([, e]) => e.gone === "detached").sort(([, x], [, y]) => y.at - x.at)[0];
      if (!detached) return [];
      const [id] = detached;
      return [{ kind: "detached", alias: h.alias, target: targetOf(h), connectionId: id, connectionName: byId.has(id) ? nameOf(id) : h.alias, deleted: !byId.has(id) }];
    });
    return [...rows, ...skippedRows];
  }

  const taken = new Set(Object.entries(managed).filter(([, e]) => !e.gone).map(([id]) => id));
  const free = connections.filter((c) => !taken.has(c.id) && linkable(c));
  const isFree = (id: string) => free.some((c) => c.id === id);
  const levels: [LinkReason, (h: SshConfigHost) => string[]][] = [
    ["legacy", (h) => [state.legacyAliases?.[h.alias]].filter((id): id is string => !!id && isFree(id))],
    ["detached", (h) => Object.entries(managed).filter(([id, e]) => e.gone === "detached" && e.alias === h.alias && isFree(id)).map(([id]) => id)],
    ["name", (h) => free.filter((c) => c.name === h.alias && sameAddress(c, h)).map((c) => c.id)],
    ["address", (h) => free.filter((c) => sameAddress(c, h)).map((c) => c.id)],
  ];
  const used = new Set<string>();
  const settled = new Map<string, HostRow>(hosts.flatMap((h) => {
    const follows = followRow(h);
    return follows ? [[h.alias, follows] as const] : [];
  }));
  for (const [reason, find] of levels) {
    for (const h of hosts) {
      if (settled.has(h.alias)) continue;
      const ids = find(h).filter((id) => !used.has(id));
      if (ids.length === 1) {
        used.add(ids[0]);
        const identity = h.identityFile && identities.find((i) => i.id === byId.get(ids[0])?.identity_id);
        settled.set(h.alias, {
          kind: "link", alias: h.alias, target: targetOf(h), reason, connectionId: ids[0], connectionName: nameOf(ids[0]),
          ...(identity && { identityName: identity.name || identity.username }),
        });
      } else if (ids.length > 1) {
        settled.set(h.alias, { kind: "ambiguous", alias: h.alias, target: targetOf(h), candidates: ids.map(nameOf) });
      }
    }
  }
  const rows = hosts.map((h): HostRow => settled.get(h.alias) ?? { kind: "create", alias: h.alias, target: targetOf(h) });
  return [...rows, ...skippedRows];
}

export async function keyRows(hosts: SshConfigHost[], vault: string): Promise<KeyRow[]> {
  const paths = identityPaths(hosts);
  if (paths.length === 0) return [];
  const [files, ctx] = await Promise.all([readOpensshFiles(paths, "probe"), importCtxOf(vault, reloadKeys)]);
  const dupes = findDupes(ctx, vault);
  const statesOf = (copyKeys: boolean) => keyExportsOf(paths, files, copyKeys).entries.map((e): KeyState =>
    (e.key ? dupes.key(e.key) : dupes.keyRef(e.ref)) ? "exists" : e.key ? "copy" : files.keys[e.path]?.privateReadable ? "notCopied" : "unreadable");
  const [copy, ref] = [statesOf(true), statesOf(false)];
  return paths.map((path, i) => ({ name: baseName(path), path, state: { copy: copy[i], ref: ref[i] } }));
}

export async function loadPreview(mode: "activate" | "review", vault: string): Promise<{ rows: HostRow[]; keys: KeyRow[] }> {
  const { hosts, skipped } = splitSupported(parseOpensshFiles(await readOpensshFiles()));
  const [connections, state, keys, identities] = await Promise.all([
    connApi.listConnections(),
    loadSshConfigState(),
    mode === "activate" ? keyRows(hosts, vault) : Promise.resolve([]),
    listIdentities(),
  ]);
  return { rows: planRows(hosts, skipped, connections, state, mode, identities), keys };
}

// `here` read the alias from its own config, so it owns the entry until its next run confirms or deletes it.
const entryOf = (alias: string, at: number, gone?: ManagedEntry["gone"], prev?: ManagedEntry, here?: string, linked?: boolean): ManagedEntry => ({
  alias,
  at,
  ...(gone && { gone }),
  ...(linked && { linked }),
  devices: {
    ...Object.fromEntries(Object.keys(gone ? {} : prev?.devices ?? {}).map((d) => [d, { present: false, hash: "", at }])),
    ...(here && !gone && { [here]: presentAt("", at) }),
  },
});

async function commitSwitch(patch: SshConfigState, here: string, at: number) {
  await updateSshConfigState({ ...patch, joined: { [here]: at } });
  void sshConfigSync.request("switch");
}

const sameSwitch = (sync: SyncSwitch | undefined, vault: string, copyKeys: boolean) =>
  !!sync?.on && sync.vault === vault && (sync.copyKeys !== false) === copyKeys;

export async function activate({ links, ignored, creates }: ActivationChoice, vault: string, copyKeys: boolean): Promise<void> {
  const at = Date.now();
  const [state, here] = await Promise.all([loadSshConfigState(), getDeviceId()]);
  const unblocked = Object.entries(state.managed ?? {})
    .filter(([, e]) => e.gone === "detached" && creates.includes(e.alias))
    .map(([id, e]): [string, ManagedEntry] => [id, entryOf(e.alias, at, "removed")]);
  const managed = Object.fromEntries([
    ...links.map((l): [string, ManagedEntry] => [l.connectionId, entryOf(l.alias, at, undefined, state.managed?.[l.connectionId], here, true)]),
    ...ignored.map((l): [string, ManagedEntry] => [l.connectionId, entryOf(l.alias, at, "detached")]),
    ...unblocked,
  ]);
  const sync = sameSwitch(state.sync, vault, copyKeys) ? state.sync! : { on: true, vault, copyKeys, at };
  await commitSwitch({ ...(!state.offer && { offer: "accepted" }), sync, managed }, here, at);
}

export async function changeSync(patch: Pick<Partial<SyncSwitch>, "vault" | "copyKeys">): Promise<void> {
  const [state, here] = await Promise.all([loadSshConfigState(), getDeviceId()]);
  if (!state.sync) return;
  const at = Date.now();
  await commitSwitch({ sync: { ...state.sync, ...patch, at } }, here, at);
}

async function marked(select: (id: string, e: ManagedEntry) => boolean, gone: ManagedEntry["gone"], here?: string, linked?: boolean) {
  const state = await loadSshConfigState();
  const at = Date.now();
  const managed = Object.fromEntries(
    Object.entries(state.managed ?? {}).filter(([id, e]) => select(id, e)).map(([id, e]): [string, ManagedEntry] => [id, entryOf(e.alias, at, gone, e, here, linked)]),
  );
  return { managed, at, state };
}

export async function turnOff(): Promise<void> {
  const { managed, at, state } = await marked((_, e) => !e.gone, "detached");
  await updateSshConfigState({ sync: { ...state.sync, on: false, vault: state.sync?.vault ?? PERSONAL_VAULT.id, at }, managed });
}

export async function detach(ids: string[]): Promise<void> {
  const { managed } = await marked((id) => ids.includes(id), "detached");
  await updateSshConfigState({ managed });
}

export async function linkAgain(id: string): Promise<void> {
  const exists = (await connApi.listConnections()).some((c) => c.id === id);
  const { managed } = await marked((key) => key === id, exists ? undefined : "removed", await getDeviceId(), exists);
  await updateSshConfigState({ managed });
  void sshConfigSync.request("manual");
}
