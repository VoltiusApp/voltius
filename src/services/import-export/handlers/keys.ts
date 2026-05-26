import { getSecret, storeSecret } from "@/services/vault";
import type { SshKey } from "@/types";
import type { DataTypeHandler } from "../handler";
import type { ExportBundle, KeyExport } from "../formats";
import type { ExportCtx, ImportCtx, ReloadFns, SelectionProps, StoreSlices } from "../context";
import { saveTeamVaultSecretForVault } from "@/services/teamVaultSecrets";

export const keysHandler: DataTypeHandler = {
  key: "keys",
  label: "SSH Keys",
  jsonOnly: true,

  isActive(s: SelectionProps) {
    return !s.singleConnectionId && !s.singleIdentityId && !s.connectionIds && !s.identityIds;
  },

  checkboxLabel(s: SelectionProps, count: number) {
    if (s.singleKeyId) return "SSH Key (1)";
    if (s.keyIds) return `SSH Keys (${s.keyIds.length})`;
    return `SSH Keys (${count})`;
  },

  countAvailable(stores: StoreSlices, vaultIds: string[]) {
    return stores.keys.filter(k => !k.deleted_at && vaultIds.includes(k.vault_id ?? "personal")).length;
  },

  selectItems(stores: StoreSlices, vaultIds: string[], s: SelectionProps) {
    return (s.singleKeyId
      ? stores.keys.filter(k => k.id === s.singleKeyId)
      : s.keyIds
      ? stores.keys.filter(k => s.keyIds!.includes(k.id))
      : stores.keys
    ).filter(k => vaultIds.includes(k.vault_id ?? "personal"));
  },

  accumulateFolderIds(items: unknown[], main: Set<string>) {
    for (const k of items as SshKey[]) {
      if (k.folder_id) main.add(k.folder_id);
    }
  },

  async buildExports(items: unknown[], ctx: ExportCtx, bundle: ExportBundle) {
    const keys = items as SshKey[];
    ctx.keyEidMap.clear();
    keys.forEach((k, i) => ctx.keyEidMap.set(k.id, `k${i}`));
    bundle.keys = await Promise.all(keys.map(async (k): Promise<KeyExport> => ({
      _eid: ctx.keyEidMap.get(k.id),
      name: k.name,
      key_type: k.key_type,
      tags: k.tags,
      private_key: await getSecret(`key:${k.id}:private`).catch(() => null) ?? undefined,
      public_key: await getSecret(`key:${k.id}:public`).catch(() => null) ?? undefined,
      passphrase: await getSecret(`key:${k.id}:passphrase`).catch(() => null) ?? undefined,
      _folder_eid: k.folder_id ? ctx.folderEidMap.get(k.folder_id) : undefined,
    })));
  },

  async importItems(bundle: ExportBundle, ctx: ImportCtx) {
    let imported = 0; let errors = 0;
    const existingNames = new Set(
      ctx.existingKeys
        .filter(k => !k.deleted_at && (k.vault_id ?? "personal") === ctx.vault_id)
        .map(k => k.name),
    );
    for (const key of bundle.keys) {
      if (ctx.skipDupes && key.name && existingNames.has(key.name)) {
        if (key._eid) {
          const existing = ctx.existingKeys.find(k => !k.deleted_at && (k.vault_id ?? "personal") === ctx.vault_id && k.name === key.name);
          if (existing) ctx.keyEidMap.set(key._eid, existing.id);
        }
        continue;
      }
      try {
        const saved = await ctx.stores.saveKey({
          name: key.name, key_type: key.key_type,
          tags: ctx.tag ? [...(key.tags ?? []), ctx.tag] : key.tags ?? [],
          folder_id: key._folder_eid ? ctx.folderEidMap.get(key._folder_eid) : undefined,
          vault_id: ctx.vault_id,
        });
        if (key.private_key) {
          const localKey = `key:${saved.id}:private`;
          await storeSecret(localKey, key.private_key);
          await saveTeamVaultSecretForVault(ctx.vault_id, localKey, key.private_key).catch(() => {});
        }
        if (key.public_key) {
          const localKey = `key:${saved.id}:public`;
          await storeSecret(localKey, key.public_key);
          await saveTeamVaultSecretForVault(ctx.vault_id, localKey, key.public_key).catch(() => {});
        }
        if (key.passphrase) {
          const localKey = `key:${saved.id}:passphrase`;
          await storeSecret(localKey, key.passphrase);
          await saveTeamVaultSecretForVault(ctx.vault_id, localKey, key.passphrase).catch(() => {});
        }
        if (key._eid) ctx.keyEidMap.set(key._eid, saved.id);
        imported++;
      } catch { errors++; }
    }
    return { imported, errors };
  },

  async reload(r: ReloadFns) { await r.loadKeys(); },
};
