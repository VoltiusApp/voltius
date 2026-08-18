import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useTeamStore } from "@/stores/teamStore";
import type { Snippet } from "@/types";
import type { ImportStores, ReloadFns } from "./context";

/** Personal snippets plus every team's, last write winning on a shared id. */
export function mergeSnippets(
  personal: Snippet[],
  teamMap: Record<string, Snippet[]>,
  teamIds: string[],
): Snippet[] {
  const map = new Map<string, Snippet>();
  for (const snippet of personal) map.set(snippet.id, snippet);
  for (const id of teamIds) for (const snippet of teamMap[id] ?? []) map.set(snippet.id, snippet);
  return [...map.values()];
}

/**
 * The same aggregation the import-export hooks expose, read outside React. An
 * import triggered by a deep link has no component to hang hooks off, and a
 * second hand-rolled copy of these reads is exactly what would drift.
 */
export function importStoresOf(): ImportStores {
  return {
    saveFolder: useFolderStore.getState().saveFolder,
    saveSnippetFolder: useSnippetFolderStore.getState().saveFolder,
    saveKey: useKeyStore.getState().saveKey,
    saveIdentity: useIdentityStore.getState().saveIdentity,
    saveConnection: useConnectionStore.getState().saveConnection,
    updateConnection: useConnectionStore.getState().updateConnection,
    createSnippet: useSnippetStore.getState().createSnippet,
    updateSnippet: useSnippetStore.getState().updateSnippet,
    createPfRule: usePortForwardingStore.getState().createRule,
  };
}

export function reloadFnsOf(): ReloadFns {
  return {
    loadConnections: useConnectionStore.getState().loadConnections,
    loadIdentities: useIdentityStore.getState().loadIdentities,
    loadKeys: useKeyStore.getState().loadKeys,
    loadFolders: useFolderStore.getState().loadFolders,
    loadSnippets: useSnippetStore.getState().loadSnippets,
    loadSnippetFolders: useSnippetFolderStore.getState().loadFolders,
    loadPfRules: usePortForwardingStore.getState().loadRules,
  };
}

export function allSnippetsNow(): Snippet[] {
  const snippets = useSnippetStore.getState();
  return mergeSnippets(
    snippets.snippets,
    snippets.teamSnippets,
    useTeamStore.getState().teams.map((team) => team.id),
  );
}
