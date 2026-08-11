import { getSecret, storeSecret } from "@/services/vault";
import type { SshKey } from "@/types";
import type { DataTypeHandler } from "../handler";
import type { ExportBundle, KeyExport } from "../formats";
import type { ExportCtx, ImportCtx, ReloadFns } from "../context";
import { liveInVault, selectionMethods } from "../context";
import { saveTeamVaultSecretForVault } from "@/services/teamVaultSecrets";
import { fetchKeySecrets, storeKeySecrets } from "../secretsLogic";

export const keysHandler: DataTypeHandler = {
  key: "keys",
  label: "SSH Keys",
  jsonOnly: true,

  ...selectionMethods<SshKey>("keys", "keys", s => s.keys),

  async buildExports(items: unknown[], ctx: ExportCtx, bundle: ExportBundle) {
    const keys = items as SshKey[];
    ctx.keyEidMap.clear();
    keys.forEach((k, i) => ctx.keyEidMap.set(k.id, `k${i}`));
    bundle.keys = await Promise.all(keys.map(async (k): Promise<KeyExport> => ({
      _eid: ctx.keyEidMap.get(k.id),
      name: k.name,
      key_type: k.key_type,
      tags: k.tags,
      ...(await fetchKeySecrets(k.id, (key) => getSecret(key).catch(() => null))),
      _folder_eid: k.folder_id ? ctx.folderEidMap.get(k.folder_id) : undefined,
    })));
  },

  async importItems(bundle: ExportBundle, ctx: ImportCtx) {
    let imported = 0; let errors = 0;
    const existing = liveInVault(ctx.existingKeys, ctx.vault_id);
    const existingNames = new Set(existing.map(k => k.name));
    for (const key of bundle.keys) {
      if (ctx.skipDupes && key.name && existingNames.has(key.name)) {
        if (key._eid) {
          const match = existing.find(k => k.name === key.name);
          if (match) ctx.keyEidMap.set(key._eid, match.id);
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
        await storeKeySecrets(key, saved.id, async (k, value) => {
          await storeSecret(k, value);
          await saveTeamVaultSecretForVault(ctx.vault_id, k, value).catch(() => {});
        });
        if (key._eid) ctx.keyEidMap.set(key._eid, saved.id);
        imported++;
      } catch { errors++; }
    }
    return { imported, errors };
  },

  async reload(r: ReloadFns) { await r.loadKeys(); },
};
