import type { TeamObjectType } from "@/services/teamObjects";

interface VaultObject {
  id: string;
  vault_id?: string | null;
  updated_at?: string;
}

interface ObjectKindSpec<T extends VaultObject> {
  kind: TeamObjectType;
  /** Every object of this kind on local disk, across all vaults. */
  local: T[];
  /** Fills the store's team slice so the UI and the secret backfill can see them. */
  publish: (teamId: string, items: T[]) => void;
  deleteLocal: (id: string) => Promise<void>;
}

/** An `ObjectKindSpec` with its vault filter applied and its element type erased. */
interface PreparedKind {
  kind: TeamObjectType;
  items: VaultObject[];
  publish: () => void;
  deleteLocal: (id: string) => Promise<void>;
}

function prepareKind<T extends VaultObject>(
  spec: ObjectKindSpec<T>,
  vaultId: string,
  teamId: string,
  now: string,
): PreparedKind {
  const items = spec.local
    .filter((o) => (o.vault_id ?? "personal") === vaultId)
    .map((o) => ({ ...o, vault_id: teamId, updated_at: now }));
  return { kind: spec.kind, items, publish: () => spec.publish(teamId, items), deleteLocal: spec.deleteLocal };
}

/**
 * The stores are imported lazily throughout: they pull in the whole local
 * object graph, and both entry points here are rare user actions.
 */
async function importVaultObjectStores() {
  const [conn, ident, key, folder, snippet, snippetFolder, pf] = await Promise.all([
    import("@/stores/connectionStore"),
    import("@/stores/identityStore"),
    import("@/stores/keyStore"),
    import("@/stores/folderStore"),
    import("@/stores/snippetStore"),
    import("@/stores/snippetFolderStore"),
    import("@/stores/portForwardingStore"),
  ]);
  return {
    connections: conn.useConnectionStore,
    identities: ident.useIdentityStore,
    keys: key.useKeyStore,
    folders: folder.useFolderStore,
    snippets: snippet.useSnippetStore,
    snippetFolders: snippetFolder.useSnippetFolderStore,
    rules: pf.usePortForwardingStore,
  };
}

/** Re-reads every vault-object store from local disk. */
export async function reloadLocalVaultObjectStores(): Promise<void> {
  const stores = await importVaultObjectStores();
  await Promise.all([
    stores.connections.getState().loadConnections(),
    stores.identities.getState().loadIdentities(),
    stores.keys.getState().loadKeys(),
    stores.folders.getState().loadFolders(),
    stores.snippets.getState().loadSnippets(),
    stores.snippetFolders.getState().loadFolders(),
    stores.rules.getState().loadRules(),
  ]);
}

/**
 * Moves everything a private vault already holds into the team vault it has just
 * become: uploads each object through the per-object API, then drops the local
 * copies so the team vault is the only source of truth.
 *
 * The uploads run first and as a group. Until they have all succeeded nothing
 * local has been touched, so a caller can undo the conversion by unlinking the
 * vault. Every step after that is best-effort and never throws — the objects
 * already live in the team vault, and a leftover local row is not worth failing
 * a conversion that has otherwise happened.
 */
export async function migrateVaultToTeam(vaultId: string, teamId: string): Promise<void> {
  const [
    stores,
    connApi,
    identApi,
    keyApi,
    folderApi,
    snippetApi,
    pfApi,
    { saveTeamVaultObject },
    { backfillExistingTeamVaultSecrets },
  ] = await Promise.all([
    importVaultObjectStores(),
    import("@/services/connections"),
    import("@/services/identities"),
    import("@/services/keys"),
    import("@/services/folders"),
    import("@/services/snippets"),
    import("@/services/portForwardingRules"),
    import("@/services/teamObjectPersistence"),
    import("@/services/teamVaultSecrets"),
  ]);

  const now = new Date().toISOString();
  const kinds: PreparedKind[] = [
    prepareKind({
      kind: "connection",
      local: stores.connections.getState().connections,
      publish: (t, items) => stores.connections.getState().setTeamConnections(t, items),
      deleteLocal: connApi.deleteConnection,
    }, vaultId, teamId, now),
    prepareKind({
      kind: "identity",
      local: stores.identities.getState().identities,
      publish: (t, items) => stores.identities.getState().setTeamIdentities(t, items),
      deleteLocal: identApi.deleteIdentity,
    }, vaultId, teamId, now),
    prepareKind({
      kind: "key",
      local: stores.keys.getState().keys,
      publish: (t, items) => stores.keys.getState().setTeamKeys(t, items),
      deleteLocal: keyApi.deleteKey,
    }, vaultId, teamId, now),
    prepareKind({
      kind: "folder",
      local: stores.folders.getState().folders,
      publish: (t, items) => stores.folders.getState().setTeamFolders(t, items),
      deleteLocal: folderApi.deleteFolder,
    }, vaultId, teamId, now),
    prepareKind({
      kind: "snippet",
      local: stores.snippets.getState().snippets,
      publish: (t, items) => stores.snippets.getState().setTeamSnippets(t, items),
      deleteLocal: snippetApi.deleteSnippet,
    }, vaultId, teamId, now),
    prepareKind({
      kind: "snippet_folder",
      local: stores.snippetFolders.getState().folders,
      publish: (t, items) => stores.snippetFolders.getState().setTeamSnippetFolders(t, items),
      deleteLocal: snippetApi.deleteSnippetFolder,
    }, vaultId, teamId, now),
    prepareKind({
      kind: "port_forwarding_rule",
      local: stores.rules.getState().rules,
      publish: (t, items) => stores.rules.getState().setTeamRules(t, items),
      deleteLocal: pfApi.deletePfRule,
    }, vaultId, teamId, now),
  ];

  await Promise.all(
    kinds.flatMap((k) => k.items.map((item) => saveTeamVaultObject(teamId, k.kind, item))),
  );

  // ─── Committed: the team vault now holds the vault's contents ───────────────

  for (const k of kinds) k.publish();

  // Secrets are read out of the local keychain, so this has to run before the
  // local objects (and with them their keychain entries) go away.
  await backfillExistingTeamVaultSecrets(teamId);

  await Promise.allSettled(kinds.flatMap((k) => k.items.map((item) => k.deleteLocal(item.id))));
  await reloadLocalVaultObjectStores().catch(() => {});
}
