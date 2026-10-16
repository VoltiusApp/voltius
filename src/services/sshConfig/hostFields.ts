import type { Connection, ConnectionFormData } from "@/types";
import type { ImportNotice, KeyExport, KeyRefExport } from "@/services/import-export/formats";
import type { OpensshFiles } from "@/services/import-export/parsers/openssh";
import { looksLikePrivateKey } from "@/services/import-export/parsers/common";
import { isValidSshPublicKey } from "@/services/sshPublicKey";
import type { ParsedSshConfig, SshConfigHost } from "./parse";

export const OWNED_FIELDS = ["connection_type", "host", "port", "username", "auth_type", "identity_id", "key_id", "jump_hosts"] as const;
export type OwnedField = (typeof OWNED_FIELDS)[number];

export interface JumpHop { host: string; port: number; username: string; ref?: SshConfigHost }

export function jumpHops(value: string, hosts: SshConfigHost[]): JumpHop[] {
  return value.split(",").map((s) => s.trim().replace(/^ssh:\/\//, "")).filter(Boolean).map((hop) => {
    const m = hop.match(/^(?:([^@]+)@)?(\[[^\]]+\]|[^:]+)(?::(\d+))?$/);
    const target = (m?.[2] ?? hop).replace(/^\[|\]$/g, "");
    const ref = hosts.find((h) => h.alias === target || h.otherAliases?.includes(target));
    return {
      host: ref?.hostname ?? target,
      port: m?.[3] ? Number(m[3]) : ref?.port ?? 22,
      username: m?.[1] ?? ref?.user ?? "",
      ...(ref && !ref.proxyCommand && { ref }),
    };
  });
}

export function jumpHostsOf<L extends object>(value: string, hosts: SshConfigHost[], link: (ref: SshConfigHost | undefined) => L) {
  return jumpHops(value, hosts).map(({ ref, ...hop }) => ({ id: crypto.randomUUID(), ...hop, ...link(ref) }));
}

export function connectionFieldsOf(host: SshConfigHost) {
  return {
    name: host.alias,
    host: host.hostname,
    port: host.port,
    username: host.user ?? "",
    auth_type: host.identityFile ? ("key" as const) : ("password" as const),
    connection_type: "ssh" as const,
  };
}

export const fingerprint = (h: SshConfigHost) =>
  JSON.stringify([h.hostname, h.port, h.user ?? "", h.identityFile ?? "", h.proxyJump ?? ""]);

export const keylessFingerprint = (h: SshConfigHost) => fingerprint({ ...h, identityFile: undefined });

function parseFingerprint(fp: string | undefined): [string, number, string, string, string] | undefined {
  if (!fp) return undefined;
  try {
    const value: unknown = JSON.parse(fp);
    return Array.isArray(value) ? (value as [string, number, string, string, string]) : undefined;
  } catch {
    return undefined;
  }
}

export function identityOf(fp: string | undefined): string | undefined {
  return parseFingerprint(fp)?.[3] || undefined;
}

export type OwnedSnapshot = Pick<Connection, "host" | "port" | "username" | "connection_type" | "auth_type" | "identity_id" | "key_id" | "jump_hosts">;
export type Drift = "address" | "key" | "jumps";

// `key` is the key id that device resolved; a presence without one only requires some key.
export function driftOf(c: OwnedSnapshot, { hash, key }: { hash: string; key?: string }, hosts: SshConfigHost[], aliasOf: (id: string) => string | undefined): Drift[] {
  const parsed = parseFingerprint(hash);
  if (!parsed) return ["address", "key", "jumps"];
  const [hostname, port, user, identityFile, proxyJump] = parsed;
  const jumps = c.jump_hosts ?? [];
  const hops = proxyJump ? jumpHops(proxyJump, hosts) : undefined;
  const sameHop = (hop: JumpHop, i: number) => {
    const j = jumps[i];
    return j.connection_id ? aliasOf(j.connection_id) === hop.ref?.alias : j.host === hop.host && j.port === hop.port && (j.username ?? "") === hop.username;
  };
  return [
    ...((c.connection_type ?? "ssh") !== "ssh" || c.host !== hostname || c.port !== port || (!!user && (c.username ?? "") !== user) ? ["address" as const] : []),
    ...(identityFile && (c.auth_type !== "key" || !!c.identity_id || !c.key_id || (!!key && c.key_id !== key)) ? ["key" as const] : []),
    ...(hops && (hops.length !== jumps.length || !hops.every(sameHop)) ? ["jumps" as const] : []),
  ];
}

export const baseName = (path: string) => path.split(/[/\\]/).pop() || path;

export type KeyEntry = { path: string; key: KeyExport; ref?: undefined } | { path: string; key?: undefined; ref: KeyRefExport };

function keyEntryOf(path: string, files: OpensshFiles | undefined, eid: string, copyKeys: boolean): KeyEntry {
  const found = files?.keys[path];
  const text = found?.privateKey;
  const publicKey = [found?.publicKey, text].map((v) => v?.trim()).find((v) => v && isValidSshPublicKey(v));
  // A probe withholds the text, so a preview of the copy only knows that the key is readable.
  const copyable = text ? looksLikePrivateKey(text) : !!found?.privateReadable;
  if (copyKeys && copyable) return { path, key: { _eid: eid, name: baseName(path), tags: [], private_key: text ?? "", ...(publicKey && { public_key: publicKey }) } };
  // A key file present here with an unknown public half may not be the vault key sharing its name.
  const guessable = !(found?.privateReadable && !publicKey);
  return { path, ref: { _eid: eid, ...(guessable && { name: baseName(path) }), public_key: publicKey ?? "" } };
}

export function keyExportsOf(paths: string[], files: OpensshFiles | undefined, copyKeys = true) {
  const eids = new Map(paths.map((path, i) => [path, `k${i}`]));
  const entries = paths.map((path) => keyEntryOf(path, files, eids.get(path)!, copyKeys));
  return { entries, keys: entries.flatMap((e) => e.key ?? []), keyRefs: entries.flatMap((e) => e.ref ?? []), eidOf: (path: string) => eids.get(path)! };
}

export const identityPaths = (hosts: SshConfigHost[]) => [...new Set(hosts.flatMap((h) => h.identityFile ?? []))];

export const targetOf = (h: SshConfigHost) => `${h.user ? `${h.user}@` : ""}${h.hostname}:${h.port}`;

export interface SkippedAlias { alias: string; reason: ImportNotice["kind"] | "keyNotCopied" | "pending"; target: string }

export function splitSupported(parsed: ParsedSshConfig): { hosts: SshConfigHost[]; skipped: (SkippedAlias & { reason: ImportNotice["kind"] })[] } {
  return {
    hosts: parsed.hosts.filter((h) => !h.proxyCommand),
    skipped: [
      ...parsed.skipped.map((n) => ({ alias: n.text, reason: n.kind, target: "" })),
      ...parsed.hosts.filter((h) => h.proxyCommand).map((h) => ({ alias: h.alias, reason: "proxyCommand" as const, target: targetOf(h) })),
    ],
  };
}

export const BASE_OWNED: readonly OwnedField[] = ["connection_type", "host", "port"];

export function ownedFieldsOf(host: SshConfigHost): OwnedField[] {
  return OWNED_FIELDS.filter((f) =>
    BASE_OWNED.includes(f)
    || (f === "username" && !!host.user)
    || ((f === "auth_type" || f === "identity_id" || f === "key_id") && !!host.identityFile)
    || (f === "jump_hosts" && !!host.proxyJump));
}

export function ownedFromHash(hash: string | undefined): readonly OwnedField[] {
  const parsed = parseFingerprint(hash);
  if (!parsed) return BASE_OWNED;
  const [hostname, port, user, identityFile, proxyJump] = parsed;
  return ownedFieldsOf({ alias: "", hostname, port, ...(user && { user }), ...(identityFile && { identityFile }), ...(proxyJump && { proxyJump }) });
}

export function pickOwned(fields: Partial<ConnectionFormData>, owned: readonly OwnedField[]): Partial<ConnectionFormData> {
  return Object.fromEntries(Object.entries(fields).filter(([k]) => (owned as readonly string[]).includes(k)));
}

const KEY_FIELDS: readonly OwnedField[] = ["auth_type", "identity_id", "key_id"];

// Keys are vault-scoped: a move drops the owned key and the sync re-resolves it in the new vault.
export function keepOwned(conn: Connection, data: ConnectionFormData, owned: readonly OwnedField[]): ConnectionFormData {
  if (owned.length === 0) return data;
  const moved = data.vault_id !== undefined && data.vault_id !== conn.vault_id;
  return { ...data, ...pickOwned(conn, moved ? owned.filter((f) => !KEY_FIELDS.includes(f)) : owned) };
}

export function ownedFieldsChanged(conn: Connection, patch: Partial<ConnectionFormData>, owned: readonly OwnedField[]): OwnedField[] {
  return owned.filter((f) => f in patch && patch[f] !== undefined && JSON.stringify(patch[f] ?? undefined) !== JSON.stringify(conn[f] ?? undefined));
}
