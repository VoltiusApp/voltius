import type { PluginManifest, PluginRegisterFn } from "@/plugins/api";
// Logic lives in services/import-export; this file only wires up plugin contributions.
import { useUIStore } from "@/stores/uiStore";
import type { Connection, SshKey, Identity } from "@/types";

export const manifest: PluginManifest = {
  id: "plugin-import-export",
  name: "Import / Export",
  version: "1.0.0",
  description: "Import and export hosts, identities, and SSH keys as JSON or CSV.",
  permissions: [
    "connections:read", "connections:write",
    "identities:read", "identities:write",
    "keys:read", "keys:write",
    "ui-contributions",
  ],
  defaultEnabled: true,
};

export const register: PluginRegisterFn = (api) => {
  // Omni commands are registered as core via importExport.commands.ts.
  // ── UI contributions ─────────────────────────────────────────────────────

  const unregConnCtx = api.ui.registerContribution<Connection>(
    "connection.contextMenu",
    (conn) => [{ label: "Export", icon: "lucide:download", onClick: () => useUIStore.getState().openImportExport("export", { connectionId: conn.id }) }],
  );

  const unregConnPanel = api.ui.registerContribution<Connection>(
    "connection.panelActions",
    (conn) => [{ label: "Export", icon: "lucide:download", onClick: () => useUIStore.getState().openImportExport("export", { connectionId: conn.id }) }],
  );

  const unregKeyCtx = api.ui.registerContribution<SshKey>(
    "key.contextMenu",
    (key) => [{ label: "Export", icon: "lucide:download", onClick: () => useUIStore.getState().openImportExport("export", { keyId: key.id }) }],
  );

  const unregKeyPanel = api.ui.registerContribution<SshKey | undefined>(
    "key.panelActions",
    (key) => key ? [{ label: "Export", icon: "lucide:download", onClick: () => useUIStore.getState().openImportExport("export", { keyId: key.id }) }] : [],
  );

  const unregIdentCtx = api.ui.registerContribution<Identity>(
    "identity.contextMenu",
    (identity) => [{ label: "Export", icon: "lucide:download", onClick: () => useUIStore.getState().openImportExport("export", { identityId: identity.id }) }],
  );

  const unregIdentPanel = api.ui.registerContribution<Identity | undefined>(
    "identity.panelActions",
    (identity) => identity ? [{ label: "Export", icon: "lucide:download", onClick: () => useUIStore.getState().openImportExport("export", { identityId: identity.id }) }] : [],
  );

  const unregHomeBg = api.ui.registerContribution(
    "home.bgContextMenu",
    () => [
      { label: "Import…", icon: "lucide:upload", onClick: () => useUIStore.getState().openImportExport("import"), divider: true },
      { label: "Export…", icon: "lucide:download", onClick: () => useUIStore.getState().openImportExport("export") },
    ],
  );

  const unregKeychainBg = api.ui.registerContribution(
    "keychain.bgContextMenu",
    () => [
      { label: "Import…", icon: "lucide:upload", onClick: () => useUIStore.getState().openImportExport("import"), divider: true },
      { label: "Export…", icon: "lucide:download", onClick: () => useUIStore.getState().openImportExport("export") },
    ],
  );

  const unregToolbar = api.ui.registerContribution(
    "home.toolbar.hostMenu",
    () => [
      { label: "Import…", icon: "lucide:upload", onClick: () => useUIStore.getState().openImportExport("import") },
      { label: "Export…", icon: "lucide:download", onClick: () => useUIStore.getState().openImportExport("export") },
    ],
  );

  const unregSettings = api.ui.registerContribution(
    "settings.vaults",
    () => [
      { label: "Export Vault", icon: "lucide:download", onClick: () => useUIStore.getState().openImportExport("export") },
      { label: "Import into Vault", icon: "lucide:upload", onClick: () => useUIStore.getState().openImportExport("import") },
    ],
  );

  return () => {
    unregConnCtx();
    unregConnPanel();
    unregKeyCtx();
    unregKeyPanel();
    unregIdentCtx();
    unregIdentPanel();
    unregHomeBg();
    unregKeychainBg();
    unregToolbar();
    unregSettings();
  };
};
