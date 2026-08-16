// A keyed map merged row by row: a list under last-write-wins would lose a vault
// created on another device and revive one deleted there.

import type { Vault } from "@/stores/vaultStore";

export interface SyncedVault {
  name: string;
  teamId?: string;
  updatedAt: string;
  deletedAt?: string;
}

export type VaultsSection = Record<string, SyncedVault>;

export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

const EPOCH = new Date(0).toISOString();

export function isAliveVaultRow(row: SyncedVault): boolean {
  return !row.deletedAt || row.updatedAt > row.deletedAt;
}

export function parseVaultsSection(value: unknown): VaultsSection {
  if (!value || typeof value !== "object") return {};
  const out: VaultsSection = {};
  for (const [id, row] of Object.entries(value as Record<string, unknown>)) {
    const r = row as Partial<SyncedVault>;
    if (typeof r?.name !== "string" || typeof r?.updatedAt !== "string") continue;
    out[id] = buildRow(r.name, r.updatedAt, r.teamId, r.deletedAt);
  }
  return out;
}

function buildRow(name: string, updatedAt: string, teamId?: string, deletedAt?: string): SyncedVault {
  const row: SyncedVault = { name, updatedAt };
  if (teamId) row.teamId = teamId;
  if (deletedAt) row.deletedAt = deletedAt;
  return row;
}

function sameRow(a: SyncedVault, b: SyncedVault): boolean {
  return a.name === b.name && a.teamId === b.teamId
    && a.updatedAt === b.updatedAt && a.deletedAt === b.deletedAt;
}

// Field-wise, like `crdt.ts`: `deletedAt` takes the later of the two so a device
// that never saw the deletion cannot drop it. Equal timestamps keep local.
function mergeRow(local: SyncedVault, remote: SyncedVault): SyncedVault {
  const winner = remote.updatedAt > local.updatedAt ? remote : local;
  const deletedAt = [local.deletedAt, remote.deletedAt].filter(Boolean).sort().pop();
  return buildRow(winner.name, winner.updatedAt, winner.teamId, deletedAt);
}

export function mergeVaultSections(
  local: unknown,
  remote: unknown,
): { value: VaultsSection; updated: boolean } {
  const l = parseVaultsSection(local);
  const r = parseVaultsSection(remote);
  const value: VaultsSection = {};
  let updated = false;

  for (const id of new Set([...Object.keys(l), ...Object.keys(r)])) {
    const localRow = l[id];
    const remoteRow = r[id];
    const merged = localRow && remoteRow ? mergeRow(localRow, remoteRow) : (localRow ?? remoteRow);
    value[id] = merged;
    if (!localRow || !sameRow(localRow, merged)) updated = true;
  }

  return { value, updated };
}

export function pruneVaultTombstones(section: VaultsSection, now: number = Date.now()): VaultsSection {
  const out: VaultsSection = {};
  for (const [id, row] of Object.entries(section)) {
    if (row.deletedAt && !isAliveVaultRow(row) && now - Date.parse(row.deletedAt) > TOMBSTONE_TTL_MS) continue;
    out[id] = row;
  }
  return out;
}

export function vaultsSectionFrom(vaults: Vault[], deletedVaults: VaultsSection): VaultsSection {
  const section: VaultsSection = { ...deletedVaults };
  for (const vault of vaults) {
    if (vault.id === "personal") continue;
    section[vault.id] = buildRow(vault.name, vault.updatedAt ?? EPOCH, vault.teamId);
  }
  return pruneVaultTombstones(section);
}

export function vaultRowToVault(id: string, row: SyncedVault): Vault {
  const vault: Vault = { id, name: row.name, updatedAt: row.updatedAt };
  if (row.teamId) vault.teamId = row.teamId;
  return vault;
}

export function newestVaultTimestamp(section: VaultsSection): string {
  let newest = EPOCH;
  for (const row of Object.values(section)) {
    for (const ts of [row.updatedAt, row.deletedAt]) {
      if (ts && ts > newest) newest = ts;
    }
  }
  return newest;
}
