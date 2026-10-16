import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useTeamStore } from "@/stores/teamStore";
import type { Vault } from "@/stores/vaultStore";
import type { PortForwardingRule, Snippet } from "@/types";
import { loadPublicKeys } from "@/services/publicKeyStore";
import type { ExportBundle } from "./formats";
import { liveInVault, newImportCtx } from "./context";
import type { ImportCtx, ImportStores, ReloadFns, StoreSlices } from "./context";
import { reloadAll, runImport } from "./registry";

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

/** The vault an install lands in — the selected one, or the personal vault. */
export function resolveInstallVault(state: {
  selectedVaultIds: string[];
  vaults: Vault[];
}): { id: string; name: string } {
  const id = state.selectedVaultIds[0] ?? "personal";
  return { id, name: state.vaults.find((vault) => vault.id === id)?.name ?? id };
}

/** Same undelete rule as useAllPortForwardingRules: a later update past deleted_at revives the rule. */
function isAlivePfRule(rule: PortForwardingRule): boolean {
  return !rule.deleted_at || rule.updated_at > rule.deleted_at;
}

/** The React hooks' aggregation (useAllConnections and friends), without React. */
export function storeSlicesOf(): StoreSlices {
  const teamIds = useTeamStore.getState().teams.map((t) => t.id);
  const merge = <T extends { id: string }>(
    personal: T[], team: Record<string, T[]>, alive: (x: T) => boolean = () => true,
  ): T[] => {
    const map = new Map<string, T>();
    for (const x of personal) if (alive(x)) map.set(x.id, x);
    for (const tid of teamIds) for (const x of team[tid] ?? []) if (alive(x)) map.set(x.id, x);
    return [...map.values()];
  };
  const c = useConnectionStore.getState();
  const i = useIdentityStore.getState();
  const k = useKeyStore.getState();
  const f = useFolderStore.getState();
  const s = useSnippetStore.getState();
  const sf = useSnippetFolderStore.getState();
  const pf = usePortForwardingStore.getState();
  return {
    connections: merge(c.connections, c.teamConnections ?? {}),
    identities: merge(i.identities, i.teamIdentities ?? {}),
    keys: merge(k.keys, k.teamKeys ?? {}),
    folders: merge(f.folders, f.teamFolders ?? {}),
    snippets: merge(s.snippets, s.teamSnippets ?? {}),
    snippetFolders: merge(sf.folders, sf.teamSnippetFolders ?? {}),
    pfRules: merge(pf.rules, pf.teamRules ?? {}, isAlivePfRule),
  };
}

type Reload = (fns: ReloadFns) => Promise<void>;

export const reloadKeys: Reload = (fns) => fns.loadKeys();
export const noReload: Reload = async () => {};

export async function importCtxOf(vaultId: string, reload: Reload = reloadAll): Promise<ImportCtx> {
  await reload(reloadFnsOf());
  const slices = storeSlicesOf();
  return newImportCtx({
    vault_id: vaultId,
    tag: "",
    skipDupes: true,
    existingConnections: slices.connections,
    existingKeys: slices.keys,
    existingPublicKeys: await loadPublicKeys(liveInVault(slices.keys, vaultId)),
    existingIdentities: slices.identities,
    existingSnippets: slices.snippets,
    existingPfRules: slices.pfRules,
    existingFolders: [...slices.folders, ...slices.snippetFolders],
    stores: importStoresOf(),
  });
}

export async function importIntoVault(bundle: ExportBundle, vaultId: string, reload?: Reload) {
  const ctx = await importCtxOf(vaultId, reload);
  const { imported, errors } = await runImport(bundle, ctx);
  return { imported, errors, keyIds: ctx.keyEidMap, connectionIds: ctx.connectionEidMap };
}
