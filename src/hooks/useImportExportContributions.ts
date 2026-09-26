import { useEffect } from "react";
import { useUIContributionStore } from "@/stores/uiContributionStore";
import { useUIStore } from "@/stores/uiStore";
import i18n from "@/i18n";
import type { Connection, SshKey, Identity, PortForwardingRule } from "@/types";

const ID = "core:import-export";

type ExportKey = "connections" | "keys" | "identities" | "portForwardingRules";

// Labels are translated inside the factories, which run at render.
const exportItem = (key: ExportKey, id: string) => [{
  label: i18n.t("importExport.menu.export"),
  icon: "lucide:upload",
  onClick: () => useUIStore.getState().openImportExport("export", { single: { key, id } }),
}];

const bgMenu = () => [
  { label: i18n.t("importExport.menu.importEllipsis"), icon: "lucide:download", onClick: () => useUIStore.getState().openImportExport("import"), divider: true },
  { label: i18n.t("importExport.menu.exportEllipsis"), icon: "lucide:upload", onClick: () => useUIStore.getState().openImportExport("export") },
];

export function useImportExportContributions() {
  useEffect(() => {
    const { registerContribution } = useUIContributionStore.getState();

    const unregs = [
      registerContribution(ID, "connection.contextMenu", (conn: Connection) => exportItem("connections", conn.id)),
      registerContribution(ID, "connection.panelActions", (conn: Connection) => exportItem("connections", conn.id)),
      registerContribution(ID, "key.contextMenu", (key: SshKey) => exportItem("keys", key.id)),
      registerContribution(ID, "key.panelActions", (key: SshKey | undefined) => key ? exportItem("keys", key.id) : []),
      registerContribution(ID, "identity.contextMenu", (identity: Identity) => exportItem("identities", identity.id)),
      registerContribution(ID, "identity.panelActions", (identity: Identity | undefined) => identity ? exportItem("identities", identity.id) : []),
      registerContribution(ID, "portForwardingRule.contextMenu", (rule: PortForwardingRule) => exportItem("portForwardingRules", rule.id)),
      registerContribution(ID, "home.bgContextMenu", bgMenu),
      registerContribution(ID, "keychain.bgContextMenu", bgMenu),
    ];

    return () => { for (const unreg of unregs) unreg(); };
  }, []);
}
