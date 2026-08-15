import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useTeamStore } from "@/stores/teamStore";
import { HANDLERS, buildBundle, runImport, reloadAll } from "@/services/import-export/registry";
import { toJSON, encryptText, decryptText, detectFormat } from "@/services/import-export/formats";
import { parseImport } from "@/services/import-export/importers";
import { connectionsToCSV } from "@/services/import-export/parsers/csv";
import type { ExportBundle } from "@/services/import-export/formats";
import type { ImportStores, ReloadFns, StoreSlices } from "@/services/import-export/context";
import type { PortForwardingRule } from "@/types";
import { failed, type DomainResult } from "./result";
// Declared in the tool layer: it is the only value toolSurface/tools/importExport.ts
// needs from this module, and importing it by value there would drag this
// domain's whole store graph into the MCP bundle. Re-exported here so every
// other importer of this module is unaffected.
import { EXPORT_TYPES, type ExportType } from "@/plugins/toolSurface/tools/importExport";
export { EXPORT_TYPES, type ExportType };

/** Caller-facing type name → DataTypeHandler key (registry.ts's HANDLERS[].key). */
const HANDLER_KEY: Record<ExportType, string> = {
  connections: "connections",
  identities: "identities",
  keys: "keys",
  snippets: "snippets",
  pf_rules: "portForwardingRules",
};

export interface ExportResult {
  content?: string;
  path?: string;
  encrypted: boolean;
  counts: Record<string, number>;
}

export interface ImportResult {
  imported: number;
  errors: number;
  counts: Record<string, number>;
  dryRun: boolean;
  /** Set when the import itself succeeded but the post-import store reload failed partway. */
  reloadWarning?: string;
}

/** Same undelete rule as useAllPortForwardingRules: a later update past deleted_at revives the rule. */
function isAlivePfRule(rule: PortForwardingRule): boolean {
  return !rule.deleted_at || rule.updated_at > rule.deleted_at;
}

/** The React hooks' aggregation (useAllConnections and friends), without React. */
function storeSlices(): StoreSlices {
  const teamIds = useTeamStore.getState().teams.map((t) => t.id);
  // Filters before inserting, like every useAllX hook — matters only when the same
  // id appears in both the personal and a team slice.
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

function importStores(): ImportStores {
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

function reloadFns(): ReloadFns {
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

function bundleCounts(bundle: ExportBundle): Record<string, number> {
  const counts: Record<string, number> = { folders: bundle.folders.length };
  for (const h of HANDLERS) {
    counts[h.key] = (bundle[h.key as keyof ExportBundle] as unknown[] | undefined)?.length ?? 0;
  }
  return counts;
}

/**
 * Which selected types carry secret material. Mirrors ExportTab's `hasSecrets`
 * check exactly — here it is a refusal rather than a default-on checkbox,
 * because an unencrypted bundle returned over MCP lands in the client's
 * transcript and the model's context, off this machine.
 */
function secretBearingTypes(bundle: ExportBundle): string[] {
  const out: string[] = [];
  if (bundle.connections.some((c) => c.password || c.private_key || c.passphrase || c.notes)) out.push("connections");
  if (bundle.identities.some((i) => i.password)) out.push("identities");
  if (bundle.keys.some((k) => k.private_key || k.passphrase)) out.push("keys");
  return out;
}

export async function exportObjects(opts: {
  vaultIds: string[];
  types: ExportType[];
  format: "json" | "csv";
  passphrase?: string;
}): Promise<DomainResult<ExportResult>> {
  const selected = opts.types.length > 0 ? opts.types : [...EXPORT_TYPES];
  // Mirrors ExportTab's mask: a jsonOnly handler (identities, keys, snippets,
  // pf_rules) never appears in a CSV bundle, so counts, secret detection and
  // the emitted content all describe the same artifact.
  const isCsv = opts.format === "csv";
  const enabled: Record<string, boolean> = Object.fromEntries(
    HANDLERS.map((h) => [h.key, selected.some((t) => HANDLER_KEY[t] === h.key) && (!h.jsonOnly || !isCsv)]),
  );
  // The in-memory stores may predate any write that came in over MCP (they are
  // seeded at boot and refreshed only by UI actions). Refresh before reading
  // them: a partial refresh here would silently omit objects from the bundle —
  // the same bug this fixes — so a reload failure fails the export outright
  // rather than degrading, unlike the post-write reload below.
  try {
    await reloadAll(reloadFns());
  } catch (e) {
    return failed(`could not refresh stores before export: ${e instanceof Error ? e.message : String(e)}`);
  }

  let bundle: ExportBundle;
  try {
    bundle = await buildBundle(enabled, storeSlices(), opts.vaultIds, {});
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e));
  }

  const counts = bundleCounts(bundle);
  const secrets = secretBearingTypes(bundle);
  if (secrets.length > 0 && !opts.passphrase) {
    return failed(
      `this export carries secrets (${secrets.join(", ")}); pass a passphrase to receive it encrypted, `
      + "or narrow `types` to a selection that carries none",
    );
  }

  try {
    const plain = opts.format === "csv" ? connectionsToCSV(bundle.connections) : toJSON(bundle);
    if (!opts.passphrase) return { ok: true, result: { content: plain, encrypted: false, counts } };
    return { ok: true, result: { content: await encryptText(plain, opts.passphrase), encrypted: true, counts } };
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e));
  }
}

export async function importObjects(opts: {
  content: string;
  vaultId: string;
  passphrase?: string;
  dryRun: boolean;
}): Promise<DomainResult<ImportResult>> {
  let text = opts.content;
  if (detectFormat(text) === "voltius-encrypted") {
    if (!opts.passphrase) return failed("this bundle is encrypted; pass the passphrase it was exported with");
    try {
      text = await decryptText(text, opts.passphrase);
    } catch {
      return failed("could not decrypt this bundle; the passphrase does not match");
    }
  }

  let bundle: ExportBundle;
  try {
    const parsed = parseImport(text);
    if (parsed === "encrypted") return failed("this bundle is encrypted; pass the passphrase it was exported with");
    bundle = parsed;
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e));
  }

  const counts = bundleCounts(bundle);
  if (opts.dryRun) return { ok: true, result: { imported: 0, errors: 0, counts, dryRun: true } };

  // Same staleness risk as export: a stale duplicate-detection list would
  // re-import an object that already exists over MCP as a "duplicate" and
  // skip it, or (worse) miss a real duplicate and double it. No writes have
  // happened yet, so a reload failure here fails outright rather than
  // proceeding on an unknown store state.
  try {
    await reloadAll(reloadFns());
  } catch (e) {
    return failed(`could not refresh stores before import: ${e instanceof Error ? e.message : String(e)}`);
  }

  const slices = storeSlices();
  let imported: number;
  let errors: number;
  try {
    ({ imported, errors } = await runImport(bundle, {
      vault_id: opts.vaultId,
      tag: "",
      skipDupes: false,
      existingConnections: slices.connections,
      existingKeys: slices.keys,
      existingIdentities: slices.identities,
      existingSnippets: slices.snippets,
      existingPfRules: slices.pfRules,
      folderEidMap: new Map(),
      snippetFolderEidMap: new Map(),
      keyEidMap: new Map(),
      identityEidMap: new Map(),
      connectionEidMap: new Map(),
      stores: importStores(),
    }));
  } catch (e) {
    return failed(e instanceof Error ? e.message : String(e));
  }

  // The items are already written at this point — a reload failure (e.g. a
  // network hiccup re-fetching team data) must not turn a successful import
  // into a reported failure. Surface it as a warning alongside the real counts.
  try {
    await reloadAll(reloadFns());
  } catch (e) {
    return {
      ok: true,
      result: {
        imported, errors, counts, dryRun: false,
        reloadWarning: `import succeeded but reloading stores afterward failed: ${e instanceof Error ? e.message : String(e)}`,
      },
    };
  }
  return { ok: true, result: { imported, errors, counts, dryRun: false } };
}
