import type { Identity } from "@/types";
import { getSecret, storeSecret } from "@/services/vault";
import { saveTeamVaultSecretForVault } from "@/services/teamVaultSecrets";
import type { DataTypeHandler } from "../handler";
import type { ExportBundle, IdentityExport } from "../formats";
import type { ExportCtx, ImportCtx, ReloadFns, SelectionProps, StoreSlices } from "../context";

export const identitiesHandler: DataTypeHandler = {
  key: "identities",
  label: "Identities",
  jsonOnly: true,

  isActive(s: SelectionProps) {
    return !s.singleConnectionId && !s.singleKeyId && !s.connectionIds && !s.keyIds;
  },

  checkboxLabel(s: SelectionProps, count: number) {
    if (s.singleIdentityId) return "Identity (1)";
    if (s.identityIds) return `Identities (${s.identityIds.length})`;
    return `Identities (${count})`;
  },

  countAvailable(stores: StoreSlices, vaultIds: string[]) {
    return stores.identities.filter(i => !i.deleted_at && vaultIds.includes(i.vault_id ?? "personal")).length;
  },

  selectItems(stores: StoreSlices, vaultIds: string[], s: SelectionProps) {
    return (s.singleIdentityId
      ? stores.identities.filter(i => i.id === s.singleIdentityId)
      : s.identityIds
      ? stores.identities.filter(i => s.identityIds!.includes(i.id))
      : stores.identities
    ).filter(i => vaultIds.includes(i.vault_id ?? "personal"));
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
      password: await getSecret(`identity:${i.id}:password`).catch(() => null) ?? undefined,
      tags: i.tags,
      _key_eid: i.key_id ? ctx.keyEidMap.get(i.key_id) : undefined,
      _folder_eid: i.folder_id ? ctx.folderEidMap.get(i.folder_id) : undefined,
    })));
    void connIdentityIds; // cascade resolved in registry orchestrator
  },

  async importItems(bundle: ExportBundle, ctx: ImportCtx) {
    let imported = 0; let errors = 0;
    for (const identity of bundle.identities) {
      try {
        const saved = await ctx.stores.saveIdentity({
          name: identity.name,
          username: identity.username,
          key_id: identity._key_eid ? ctx.keyEidMap.get(identity._key_eid) : undefined,
          tags: identity.tags ?? [],
          folder_id: identity._folder_eid ? ctx.folderEidMap.get(identity._folder_eid) : undefined,
          vault_id: ctx.vault_id,
        });
        if (identity._eid) ctx.identityEidMap.set(identity._eid, saved.id);
        if (identity.password) {
          const localKey = `identity:${saved.id}:password`;
          await storeSecret(localKey, identity.password);
          await saveTeamVaultSecretForVault(ctx.vault_id, localKey, identity.password).catch(() => {});
        }
        imported++;
      } catch { errors++; }
    }
    return { imported, errors };
  },

  async reload(r: ReloadFns) { await r.loadIdentities(); },
};
