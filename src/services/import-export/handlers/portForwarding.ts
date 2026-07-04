import i18n from "@/i18n";
import type { PortForwardingRule } from "@/types";
import type { DataTypeHandler } from "../handler";
import type { ExportBundle, PortForwardingRuleExport } from "../formats";
import type { ExportCtx, ImportCtx, ReloadFns, SelectionProps, StoreSlices } from "../context";
import { handlerActive, selectedIds } from "../context";

export const portForwardingHandler: DataTypeHandler = {
  key: "portForwardingRules",
  label: "Port Forwarding",
  jsonOnly: true,

  isActive(s: SelectionProps) {
    return handlerActive("portForwardingRules", s);
  },

  checkboxLabel(s: SelectionProps, count: number) {
    const ids = selectedIds("portForwardingRules", s);
    return i18n.t("importExport.export.checkboxLabel.portForwarding", { count: ids ? ids.length : count });
  },

  countAvailable(stores: StoreSlices, vaultIds: string[]) {
    return stores.pfRules.filter(r => !r.deleted_at && vaultIds.includes(r.vault_id ?? "personal")).length;
  },

  selectItems(stores: StoreSlices, vaultIds: string[], s: SelectionProps) {
    const ids = selectedIds("portForwardingRules", s);
    return stores.pfRules.filter(r =>
      !r.deleted_at && (ids === null || ids.includes(r.id)) && vaultIds.includes(r.vault_id ?? "personal"));
  },

  accumulateFolderIds(items: unknown[], main: Set<string>) {
    for (const r of items as PortForwardingRule[]) if (r.folder_id) main.add(r.folder_id);
  },

  async buildExports(items: unknown[], ctx: ExportCtx, bundle: ExportBundle) {
    bundle.portForwardingRules = (items as PortForwardingRule[]).map((r, i): PortForwardingRuleExport => ({
      _eid: `p${i}`,
      name: r.name,
      local_port: r.local_port,
      remote_port: r.remote_port,
      remote_host: r.remote_host,
      tunnel_type: r.tunnel_type !== "local" ? r.tunnel_type : undefined,
      bind_host: r.bind_host !== "127.0.0.1" ? r.bind_host : undefined,
      target_host: r.target_host !== "127.0.0.1" ? r.target_host : undefined,
      description: r.description,
      _connection_eids: r.connection_ids
        .map(id => ctx.connectionEidMap.get(id))
        .filter((eid): eid is string => !!eid),
      _folder_eid: r.folder_id ? ctx.folderEidMap.get(r.folder_id) : undefined,
    }));
  },

  async importItems(bundle: ExportBundle, ctx: ImportCtx) {
    let imported = 0; let errors = 0;
    const existingNames = new Set(
      ctx.existingPfRules
        .filter(r => !r.deleted_at && (r.vault_id ?? "personal") === ctx.vault_id)
        .map(r => r.name),
    );
    for (const rule of bundle.portForwardingRules) {
      if (ctx.skipDupes && existingNames.has(rule.name)) continue;
      try {
        await ctx.stores.createPfRule({
          name: rule.name,
          local_port: rule.local_port,
          remote_port: rule.remote_port,
          remote_host: rule.remote_host,
          tunnel_type: (rule.tunnel_type as import("@/types").TunnelType | undefined) ?? "local",
          bind_host: rule.bind_host ?? "127.0.0.1",
          target_host: rule.target_host ?? "127.0.0.1",
          description: rule.description,
          connection_ids: rule._connection_eids
            .map(eid => ctx.connectionEidMap.get(eid))
            .filter((id): id is string => !!id),
          folder_id: rule._folder_eid ? ctx.folderEidMap.get(rule._folder_eid) : undefined,
          vault_id: ctx.vault_id,
        });
        imported++;
      } catch { errors++; }
    }
    return { imported, errors };
  },

  async reload(r: ReloadFns) { await r.loadPfRules(); },
};
