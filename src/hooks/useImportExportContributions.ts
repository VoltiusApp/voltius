import { useEffect } from "react";
import { useUIContributionStore } from "@/stores/uiContributionStore";
import { useUIStore } from "@/stores/uiStore";
import type { Connection, SshKey, Identity, PortForwardingRule } from "@/types";

const ID = "core:import-export";

export function useImportExportContributions() {
  useEffect(() => {
    const { registerContribution } = useUIContributionStore.getState();

    const unregs = [
      registerContribution(ID, "connection.contextMenu",
        (conn: Connection) => [{ label: "Export", icon: "lucide:upload", onClick: () => useUIStore.getState().openImportExport("export", { single: { key: "connections", id: conn.id } }) }]),

      registerContribution(ID, "connection.panelActions",
        (conn: Connection) => [{ label: "Export", icon: "lucide:upload", onClick: () => useUIStore.getState().openImportExport("export", { single: { key: "connections", id: conn.id } }) }]),

      registerContribution(ID, "key.contextMenu",
        (key: SshKey) => [{ label: "Export", icon: "lucide:upload", onClick: () => useUIStore.getState().openImportExport("export", { single: { key: "keys", id: key.id } }) }]),

      registerContribution(ID, "key.panelActions",
        (key: SshKey | undefined) => key ? [{ label: "Export", icon: "lucide:upload", onClick: () => useUIStore.getState().openImportExport("export", { single: { key: "keys", id: key.id } }) }] : []),

      registerContribution(ID, "identity.contextMenu",
        (identity: Identity) => [{ label: "Export", icon: "lucide:upload", onClick: () => useUIStore.getState().openImportExport("export", { single: { key: "identities", id: identity.id } }) }]),

      registerContribution(ID, "identity.panelActions",
        (identity: Identity | undefined) => identity ? [{ label: "Export", icon: "lucide:upload", onClick: () => useUIStore.getState().openImportExport("export", { single: { key: "identities", id: identity.id } }) }] : []),

      registerContribution(ID, "portForwardingRule.contextMenu",
        (rule: PortForwardingRule) => [{ label: "Export", icon: "lucide:upload", onClick: () => useUIStore.getState().openImportExport("export", { single: { key: "portForwardingRules", id: rule.id } }) }]),

      registerContribution(ID, "home.bgContextMenu",
        () => [
          { label: "Import…", icon: "lucide:download", onClick: () => useUIStore.getState().openImportExport("import"), divider: true },
          { label: "Export…", icon: "lucide:upload", onClick: () => useUIStore.getState().openImportExport("export") },
        ]),

      registerContribution(ID, "keychain.bgContextMenu",
        () => [
          { label: "Import…", icon: "lucide:download", onClick: () => useUIStore.getState().openImportExport("import"), divider: true },
          { label: "Export…", icon: "lucide:upload", onClick: () => useUIStore.getState().openImportExport("export") },
        ]),

      registerContribution(ID, "settings.vaults",
        () => [
          { label: "Export Vault", icon: "lucide:upload", onClick: () => useUIStore.getState().openImportExport("export") },
          { label: "Import into Vault", icon: "lucide:download", onClick: () => useUIStore.getState().openImportExport("import") },
        ]),
    ];

    return () => { for (const unreg of unregs) unreg(); };
  }, []);
}
