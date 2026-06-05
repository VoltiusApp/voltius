import type { Identity } from "@/types";
import { getSecret, storeSecret } from "@/services/vault";
import { saveTeamVaultSecretForVault } from "@/services/teamVaultSecrets";
import type { DataTypeHandler } from "../handler";
import type { ExportBundle, IdentityExport } from "../formats";
import type { ExportCtx, ImportCtx, ReloadFns, SelectionProps, StoreSlices } from "../context";
import { handlerActive, isSingleSelection, selectedIds } from "../context";
import { fetchIdentitySecrets, storeIdentitySecrets } from "../secretsLogic";

export const identitiesHandler: DataTypeHandler = {
  key: "identities",
  label: "Identities",
  jsonOnly: true,

  isActive(s: SelectionProps) {
    return handlerActive("identities", s);
  },

  checkboxLabel(s: SelectionProps, count: number) {
    if (isSingleSelection("identities", s)) return "Identity (1)";
    const ids = selectedIds("identities", s);
    return `Identities (${ids ? ids.length : count})`;
  },

  countAvailable(stores: StoreSlices, vaultIds: string[]) {
    return stores.identities.filter(i => !i.deleted_at && vaultIds.includes(i.vault_id ?? "personal")).length;
  },

  selectItems(stores: StoreSlices, vaultIds: string[], s: SelectionProps) {
    const ids = selectedIds("identities", s);
    return stores.identities.filter(i =>
      (ids === null || ids.includes(i.id)) && vaultIds.includes(i.vault_id ?? "personal"));
  },

  accumulateFolderIds(items: unknown[], main: Set<string>) {
    for (const i of items as Identity[]) {
      if (i.folder_id) main.add(i.folder_id);
    }
  },

  async buildExports(items: unknown[], ctx: ExportCtx, bundle: ExportBundle) {
    // Cascade: pull in identities referenced by connections too
    const selected = items as Identity[];
    const connIdentityIds = new Set(
      (bundle.connections ?? []).map(c => c._identity_eid).filter(Boolean)
    );
    // We need original IDs for cascade, which are stored in ctx.identityEidMap inverse.
    // Instead, cascade is handled by the orchestrator passing effectiveIdentities.
    // Here we just export what we received.
    ctx.identityEidMap.clear();
    selected.forEach((i, idx) => ctx.identityEidMap.set(i.id, `i${idx}`));
    bundle.identities = await Promise.all(selected.map(async (i): Promise<IdentityExport> => ({
      _eid: ctx.identityEidMap.get(i.id),
      name: i.name,
      username: i.username,
      ...(await fetchIdentitySecrets(i.id, (key) => getSecret(key).catch(() => null))),
      tags: i.tags,
      _key_eid: i.key_id ? ctx.keyEidMap.get(i.key_id) : undefined,
      _folder_eid: i.folder_id ? ctx.folderEidMap.get(i.folder_id) : undefined,
    })));
    void connIdentityIds; // cascade resolved in registry orchestrator
  },

  async importItems(bundle: ExportBundle, ctx: ImportCtx) {
    let imported = 0; let errors = 0;
    const existingNames = new Set(
      ctx.existingIdentities
        .filter(i => !i.deleted_at && (i.vault_id ?? "personal") === ctx.vault_id)
        .map(i => i.name),
    );
    for (const identity of bundle.identities) {
      if (ctx.skipDupes && identity.name && existingNames.has(identity.name)) {
        if (identity._eid) {
          const existing = ctx.existingIdentities.find(i => !i.deleted_at && (i.vault_id ?? "personal") === ctx.vault_id && i.name === identity.name);
          if (existing) ctx.identityEidMap.set(identity._eid, existing.id);
        }
        continue;
      }
      try {
        const saved = await ctx.stores.saveIdentity({
          name: identity.name,
          username: identity.username,
          key_id: identity._key_eid ? ctx.keyEidMap.get(identity._key_eid) : undefined,
          tags: ctx.tag ? [...(identity.tags ?? []), ctx.tag] : identity.tags ?? [],
          folder_id: identity._folder_eid ? ctx.folderEidMap.get(identity._folder_eid) : undefined,
          vault_id: ctx.vault_id,
        });
        if (identity._eid) ctx.identityEidMap.set(identity._eid, saved.id);
        await storeIdentitySecrets(identity, saved.id, async (key, value) => {
          await storeSecret(key, value);
          await saveTeamVaultSecretForVault(ctx.vault_id, key, value).catch(() => {});
        });
        imported++;
      } catch { errors++; }
    }
    return { imported, errors };
  },

  async reload(r: ReloadFns) { await r.loadIdentities(); },
};
