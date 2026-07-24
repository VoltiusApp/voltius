/**
 * Team data orchestration service.
 *
 * Coordinates loading and clearing team vault data across sessions and vault
 * selections. Called from sync.ts login flows and VaultSidebar vault selection.
 */

import { useTeamStore } from "@/stores/teamStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { fetchTeamData, clearTeamKeyCache, reconcileTeamVaultKeys } from "@/services/teamVaultSync";

// Statuses that warrant a retry (transient — key not yet distributed)
const TRANSIENT_STATUSES = new Set(["not_found", "error"]);

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
