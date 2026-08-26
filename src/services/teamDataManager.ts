/**
 * Team data orchestration service.
 *
 * Coordinates loading and clearing team vault data across sessions and vault
 * selections. Called from sync.ts login flows and VaultSidebar vault selection.
 */

import { useTeamStore } from "@/stores/teamStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { useUIStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import { firstViewNav, selectedTeamId } from "@/services/teamVaultFirstAccess";
import { effectivePermissions } from "@/services/permissions";
import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { fetchTeamData, clearTeamKeyCache, reconcileTeamVaultKeys } from "@/services/teamVaultSync";

// Statuses that warrant a retry (transient — key not yet distributed)
const TRANSIENT_STATUSES = new Set(["awaiting_key", "error"]);

/**
 * Load team vault data for all teams the user belongs to.
 * Called at the end of syncOnLogin / syncOnLoginReplace.
 * allSettled — one failing team vault doesn't block the others.
 */
export async function onTeamLogin(): Promise<void> {
  const teamIds = useTeamStore.getState().teams.map((t) => t.id);
  await Promise.allSettled(
    teamIds.map(async (teamId) => {
      await fetchTeamData(teamId);
      // A key-holder redistributes to any member who joined while it was
      // offline — self-heals the async invite-acceptance lockout (issue #41).
      // No-op for non-holders (they can't unwrap the key to redistribute).
      await reconcileTeamVaultKeys(teamId);
    }),
  );
}

/**
 * Ensure team vault data is loaded when the user selects a team vault.
 * No-op if already loading or loaded.
 */
export async function onVaultSelect(teamId: string): Promise<void> {
  const status = useTeamVaultStateStore.getState().statusByTeamId[teamId];
  if (status === "loading" || status === "loaded") return;
  await fetchTeamData(teamId);
}

/**
 * Load roles/members and fetch team vault data after joining a team, with
 * automatic retry for the key-not-yet-distributed race (admin distributes the
 * vault key asynchronously after the member appears in team_members).
 *
 * Call this any time a user joins or re-joins a team — both from the SSE
 * membership_changed handler (onTeamAdded) and from the in-app invite acceptance
 * path in VaultSidebar (which loads teams before the SSE delta is computed,
 * causing the SSE handler to see a zero delta and skip onTeamAdded).
 */
export async function joinAndLoadTeamVault(teamId: string): Promise<void> {
  await Promise.allSettled([
    useTeamStore.getState().loadMembers(teamId),
    useTeamStore.getState().loadRoles(teamId),
  ]);
  for (let attempt = 0; attempt < 5; attempt++) {
    await fetchTeamData(teamId).catch(() => {});
    const status = useTeamVaultStateStore.getState().statusByTeamId[teamId];
    if (!TRANSIENT_STATUSES.has(status ?? "")) break;
    if (attempt < 4) {
      useTeamVaultStateStore.getState().setStatus(teamId, "loading");
      await new Promise<void>((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  if (useTeamVaultStateStore.getState().statusByTeamId[teamId] === "loaded") {
    applyFirstViewNav(teamId);
  }
}

/**
 * Land a member on a surface their role can use, the first time a team vault
 * opens for them (issue #70). A connect-only invitee holds CONNECT without
 * VIEW_SECRETS, so anything keychain-shaped is a wall of redacted rows.
 *
 * A no-op until the roles are known: guessing a landing surface from an
 * unresolved role is worse than leaving the user where they were.
 */
function applyFirstViewNav(teamId: string): void {
  const { teams, rolesByTeam } = useTeamStore.getState();
  const team = teams.find((t) => t.id === teamId);
  const roles = rolesByTeam[teamId];
  if (!team || !roles || roles.length === 0) return;
  useUIStore.getState().setActiveNav(firstViewNav(effectivePermissions({ role_ids: team.role_ids }, roles)));
  useUIStore.getState().setHomeView(false);
}

/**
 * Re-fetch every team vault currently stuck in `awaiting_key`.
 *
 * The server notifies each recipient of a wrapped key with `membership_changed`
 * (`put_vault_keys` in server/src/routes/team_sync.rs), but the joiner is
 * already in the team by then, so the membership delta is zero and
 * `onTeamAdded` never fires — the key lands and nothing re-reads it. Without
 * this the honest waiting state is also a permanent one until the user hits
 * Retry or restarts.
 *
 * Deliberately a foreground fetch: `{ background: true }` suppresses every
 * status write, including the "loaded" that a team with no blob yet reaches, so
 * the vault would unlock in memory while the panel kept saying "waiting".
 */
export async function refreshAwaitingKeyTeams(): Promise<void> {
  const { statusByTeamId } = useTeamVaultStateStore.getState();
  const waiting = Object.entries(statusByTeamId)
    .filter(([, status]) => status === "awaiting_key")
    .map(([teamId]) => teamId);
  await Promise.allSettled(waiting.map((teamId) => fetchTeamData(teamId)));

  // The waiting panel is on screen for exactly one team, and it has just been
  // replaced by that vault's pages — pick the ones the role can use. Any other
  // team is left alone: steering the nav from a background event would yank the
  // user out of whatever they were doing.
  const { selectedVaultIds, vaults } = useVaultStore.getState();
  const onScreen = selectedTeamId(selectedVaultIds, vaults, useTeamStore.getState().teams);
  if (
    onScreen &&
    waiting.includes(onScreen) &&
    useTeamVaultStateStore.getState().statusByTeamId[onScreen] === "loaded"
  ) {
    applyFirstViewNav(onScreen);
  }
}

/**
 * Clear all team data from memory. Called on logout and vault lock.
 */
export function onSessionEnd(): void {
  clearTeamKeyCache();
  useConnectionStore.getState().clearTeamConnections();
  useIdentityStore.getState().clearTeamIdentities();
  useKeyStore.getState().clearTeamKeys();
  useFolderStore.getState().clearTeamFolders();
  useSnippetStore.getState().clearTeamSnippets();
  useSnippetFolderStore.getState().clearTeamSnippetFolders();
  useTeamVaultStateStore.getState().clearAll();
}
