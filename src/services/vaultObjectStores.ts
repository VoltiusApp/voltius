import { useConnectionStore } from "@/stores/connectionStore";
import { useFolderStore } from "@/stores/folderStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { createVaultsAPI, type VaultPorts } from "@/plugins/domains/vaults";

/**
 * A vault is team-backed when a team carries its id — the same test
 * folderStore makes. `teamId` on the record only survives a session that set
 * it, so the team list is the authority.
 */
export const isTeamVaultId = (vaultId: string): boolean =>
  useTeamStore.getState().teams.some((t) => t.id === vaultId);

/**
 * Loads the seven stores the vault-object tabs read.
 *
 * Snippets, port-forwarding rules, keys, identities and snippet folders are
 * loaded by their own pages, so in a session that never opened them the stores
 * are empty — and an empty read is what turns "refuse a non-empty vault" into
 * silently orphaning its contents, and a paste's cascade into leaving a key
 * behind. The Vaults settings page loads the same seven for the same reason.
 */
export const hydrateVaultObjectStores = async (): Promise<void> => {
  await Promise.all([
    useConnectionStore.getState().loadConnections(),
    useIdentityStore.getState().loadIdentities(),
    useKeyStore.getState().loadKeys(),
    useFolderStore.getState().loadFolders(),
    useSnippetStore.getState().loadSnippets(),
    useSnippetFolderStore.getState().loadFolders(),
    usePortForwardingStore.getState().loadRules(),
  ]);
};

export const vaultPorts: VaultPorts = {
  vaults: {
    list: () => useVaultStore.getState().vaults,
    add: (name) => useVaultStore.getState().addVault(name),
    rename: (id, name) => useVaultStore.getState().renameVault(id, name),
    remove: (id) => useVaultStore.getState().removeVault(id),
  },
  isTeamVault: isTeamVaultId,
  /** Hydrates before counting — see `hydrateVaultObjectStores`. */
  contents: async () => {
    await hydrateVaultObjectStores();
    return {
      connections: useConnectionStore.getState().connections,
      keys: useKeyStore.getState().keys,
      identities: useIdentityStore.getState().identities,
      snippets: useSnippetStore.getState().snippets,
      portForwardingRules: usePortForwardingStore.getState().rules,
      folders: useFolderStore.getState().folders,
      snippetFolders: useSnippetFolderStore.getState().folders,
    };
  },
  remove: {
    connection: (id) => useConnectionStore.getState().deleteConnection(id),
    key: (id) => useKeyStore.getState().deleteKey(id),
    identity: (id) => useIdentityStore.getState().deleteIdentity(id),
    snippet: (id) => useSnippetStore.getState().deleteSnippet(id),
    portForwardingRule: (id) => usePortForwardingStore.getState().deleteRule(id),
    // Cascade off: the vault sweep deletes every object in the vault itself, so
    // a cascading folder delete would race it on ids already gone.
    folder: (id) => useFolderStore.getState().deleteFolder(id, { cascade: false }),
    snippetFolder: (id) => useSnippetFolderStore.getState().deleteFolder(id),
  },
};

/**
 * The vault delete behind the confirm dialog.
 *
 * Shares the plugin verb's sweep rather than repeating it: the record-only
 * delete this replaces left every object alive under a vault_id nothing
 * resolves, surfacing them as the rail's "?" entry. `cascade` is always on
 * because the dialog in front of this *is* the counts prompt the plugin verb
 * refuses without — and the promise it makes ("permanently deletes this vault
 * and its N items") is only true if the sweep runs.
 *
 * Rejects rather than half-finishing, so the caller can leave the vault record
 * in place: items that survived a failed sweep stay filed under a named vault
 * instead of becoming orphans.
 */
export const deleteVaultWithContents = (vaultId: string): Promise<void> =>
  createVaultsAPI(vaultPorts).delete(vaultId, { cascade: true });
