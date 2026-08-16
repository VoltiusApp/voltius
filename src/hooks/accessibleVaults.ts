import i18n from "@/i18n";
import type { Vault } from "@/stores/vaultStore";
import type { Team } from "@/stores/teamStore";

interface DeriveAccessibleVaultIdsInput {
  selectedVaultIds: string[];
  vaults: Vault[];
  teams: Team[];
  cloudActive: boolean;
  /** See `deriveOrphanVaultIds`. */
  orphanVaultIds?: string[];
}

export function deriveAccessibleVaultIds({
  selectedVaultIds,
  vaults,
  teams,
  cloudActive,
  orphanVaultIds = [],
}: DeriveAccessibleVaultIdsInput): string[] {
  const loadedTeamIds = new Set(teams.map((t) => t.id));
  const orphanIds = new Set(orphanVaultIds);
  const result: string[] = [];

  for (const vid of selectedVaultIds) {
    if (vid === "personal") { result.push(vid); continue; }
    const vault = vaults.find((v) => v.id === vid);
    if (vault) {
      if (!vault.teamId || cloudActive || loadedTeamIds.has(vault.teamId)) {
        result.push(vid);
        if (vault.teamId && (cloudActive || loadedTeamIds.has(vault.teamId))) result.push(vault.teamId);
      }
    } else if (loadedTeamIds.has(vid) || orphanIds.has(vid)) {
      result.push(vid);
    }
  }

  return result;
}

interface DeriveOrphanVaultIdsInput {
  objectVaultIds: (string | undefined)[];
  vaults: Vault[];
  teams: Team[];
}

/**
 * Vault ids objects are filed under that nothing local can name. Surfacing them
 * under a placeholder keeps a vault the device never received from hiding every
 * host inside it. A team vault whose team has not loaded yet looks like an
 * orphan until it does — a better wrong answer than a hidden host.
 */
export function deriveOrphanVaultIds({
  objectVaultIds,
  vaults,
  teams,
}: DeriveOrphanVaultIdsInput): string[] {
  const known = new Set<string>(["personal"]);
  for (const vault of vaults) {
    known.add(vault.id);
    if (vault.teamId) known.add(vault.teamId);
  }
  for (const team of teams) known.add(team.id);

  const orphans = new Set<string>();
  for (const id of objectVaultIds) {
    if (id && !known.has(id)) orphans.add(id);
  }
  return [...orphans].sort();
}

interface DeriveScopedVaultIdInput {
  selectedVaultIds: string[];
  vaults: Vault[];
  accessibleVaultIds: string[];
}

/**
 * The single vault the current view is scoped to, or null when it shows several
 * (or none). A page root is only a vault's root when exactly one vault is on
 * screen; with several there is no destination to name, so anything landing at
 * the root keeps the vault it already has.
 *
 * Returns the id objects actually carry — the team id for a linked team vault,
 * matching `vaultOptions` — and null when the selected vault is not currently
 * accessible, since nothing may be written into an unreachable vault.
 */
export function deriveScopedVaultId({
  selectedVaultIds,
  vaults,
  accessibleVaultIds,
}: DeriveScopedVaultIdInput): string | null {
  if (selectedVaultIds.length !== 1) return null;
  const selected = selectedVaultIds[0];
  const canonical = vaults.find((v) => v.id === selected)?.teamId ?? selected;
  return accessibleVaultIds.includes(canonical) ? canonical : null;
}

export function unknownVaultLabel(id: string): string {
  return i18n.t("layout.vaultSidebar.unknownVaultLabel", { id: id.slice(0, 8) });
}
