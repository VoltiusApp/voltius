import type { OmniCommand } from "@/plugins/api";
import { useUIStore } from "@/stores/uiStore";
import { IMPORTERS } from "@/services/import-export/importers";

const open = useUIStore.getState;

const importerCommands: OmniCommand[] = IMPORTERS.map(importer => ({
  id: `import-export:import-${importer.key}`,
  label: `Import from ${importer.label}${importer.autoExtract ? "" : "…"}`,
  icon: importer.icon,
  keywords: ["import", importer.key, importer.label.toLowerCase(), "sessions", "hosts", "connections"],
  section: "Import / Export",
  execute: () => open().openImportExport("import", {
    source: importer.key,
    autoTrigger: !!importer.autoExtract,
  }),
}));

export const commands: OmniCommand[] = [
  // ── Vault export ───────────────────────────────────────────────────────────
  {
    id: "import-export:export-all",
    label: "Export vault data…",
    icon: "lucide:upload",
    keywords: ["export", "backup", "save", "json", "csv", "download", "vault"],
    section: "Import / Export",
    execute: () => open().openImportExport("export"),
  },
  {
    id: "import-export:export-connections",
    label: "Export connections…",
    icon: "lucide:server",
    keywords: ["export", "connections", "hosts", "ssh"],
    section: "Import / Export",
    execute: () => open().openImportExport("export", { preselectedTypes: ["connections"] }),
  },
  {
    id: "import-export:export-identities",
    label: "Export identities…",
    icon: "lucide:id-card",
    keywords: ["export", "identities", "users"],
    section: "Import / Export",
    execute: () => open().openImportExport("export", { preselectedTypes: ["identities"] }),
  },
  {
    id: "import-export:export-keys",
    label: "Export SSH keys…",
    icon: "lucide:key",
    keywords: ["export", "keys", "ssh", "keychain"],
    section: "Import / Export",
    execute: () => open().openImportExport("export", { preselectedTypes: ["keys"] }),
  },
  {
    id: "import-export:export-snippets",
    label: "Export snippets…",
    icon: "lucide:braces",
    keywords: ["export", "snippets", "commands"],
    section: "Import / Export",
    execute: () => open().openImportExport("export", { preselectedTypes: ["snippets"] }),
  },
  {
    id: "import-export:export-port-forwarding",
    label: "Export port forwarding rules…",
    icon: "lucide:arrow-right-left",
    keywords: ["export", "port", "forwarding", "rules", "tunnel"],
    section: "Import / Export",
    execute: () => open().openImportExport("export", { preselectedTypes: ["portForwardingRules"] }),
  },
  // ── Vault import ───────────────────────────────────────────────────────────
  ...importerCommands,
  // ── User data ──────────────────────────────────────────────────────────────
  {
    id: "import-export:export-themes",
    label: "Export custom themes…",
    icon: "lucide:palette",
    keywords: ["export", "themes", "colors", "appearance"],
    section: "Import / Export",
    execute: () => open().openThemeImportExport("export"),
  },
  {
    id: "import-export:import-themes",
    label: "Import themes…",
    icon: "lucide:palette",
    keywords: ["import", "themes", "colors", "appearance"],
    section: "Import / Export",
    execute: () => open().openThemeImportExport("import"),
  },
];
