import type { PortForwardingRule } from "@/types";
import type { DataTypeHandler } from "../handler";
import type { ExportBundle, PortForwardingRuleExport } from "../formats";
import type { ExportCtx, ImportCtx, ReloadFns, SelectionProps, StoreSlices } from "../context";

export const portForwardingHandler: DataTypeHandler = {
  key: "portForwardingRules",
  label: "Port Forwarding",
  jsonOnly: true,

  isActive(s: SelectionProps) {
    return !s.singleConnectionId && !s.singleKeyId && !s.singleIdentityId
      && !s.connectionIds && !s.keyIds && !s.identityIds;
  },

  checkboxLabel(_s: SelectionProps, count: number) {
    return `Port Forwarding (${count})`;
  },

  countAvailable(stores: StoreSlices, vaultIds: string[]) {
    return stores.pfRules.filter(r => !r.deleted_at && vaultIds.includes(r.vault_id ?? "personal")).length;
  },

  selectItems(stores: StoreSlices, vaultIds: string[]) {
    return stores.pfRules.filter(r => !r.deleted_at && vaultIds.includes(r.vault_id ?? "personal"));
  },

  // Port forwarding rules don't use the folder system on export.
  accumulateFolderIds() {},

  async buildExports(items: unknown[], ctx: ExportCtx, bundle: ExportBundle) {
    bundle.portForwardingRules = (items as PortForwardingRule[]).map((r, i): PortForwardingRuleExport => ({
      _eid: `p${i}`,
      name: r.name,
      local_port: r.local_port,
      remote_port: r.remote_port,
      remote_host: r.remote_host,
      description: r.description,
      _connection_eids: r.connection_ids
        .map(id => ctx.connectionEidMap.get(id))
        .filter((eid): eid is string => !!eid),
    }));
  },

  async importItems(bundle: ExportBundle, ctx: ImportCtx) {
    let imported = 0; let errors = 0;
    for (const rule of bundle.portForwardingRules) {
      try {
        await ctx.stores.createPfRule({
          name: rule.name,
          local_port: rule.local_port,
          remote_port: rule.remote_port,
          remote_host: rule.remote_host,
          description: rule.description,
          connection_ids: rule._connection_eids
            .map(eid => ctx.connectionEidMap.get(eid))
            .filter((id): id is string => !!id),
          vault_id: ctx.vault_id,
        });
        imported++;
      } catch { errors++; }
    }
    return { imported, errors };
  },

  async reload(r: ReloadFns) { await r.loadPfRules(); },
};
