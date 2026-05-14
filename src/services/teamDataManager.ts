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
import { fetchTeamData, clearTeamKeyCache } from "@/services/teamVaultSync";

/**
 * Load team vault data for all teams the user belongs to.
 * Called at the end of syncOnLogin / syncOnLoginReplace.
 * allSettled — one failing team vault doesn't block the others.
 */
export async function onTeamLogin(): Promise<void> {
  const teamIds = useTeamStore.getState().teams.map((t) => t.id);
  await Promise.allSettled(teamIds.map((teamId) => fetchTeamData(teamId)));
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
