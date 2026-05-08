import type { OmniCommand } from "@/plugins/api";
import { useUIStore } from "@/stores/uiStore";

const open = useUIStore.getState;

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
    icon: "lucide:user",
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
    icon: "lucide:code-2",
    keywords: ["export", "snippets", "commands"],
    section: "Import / Export",
    execute: () => open().openImportExport("export", { preselectedTypes: ["snippets"] }),
  },
  {
    id: "import-export:export-port-forwarding",
    label: "Export port forwarding rules…",
    icon: "lucide:git-branch",
    keywords: ["export", "port", "forwarding", "rules", "tunnel"],
    section: "Import / Export",
    execute: () => open().openImportExport("export", { preselectedTypes: ["portForwardingRules"] }),
  },
  // ── Vault import ───────────────────────────────────────────────────────────
  {
    id: "import-export:import",
    label: "Import into vault…",
    icon: "lucide:download",
    keywords: ["import", "upload", "json", "csv", "restore", "hosts", "connections"],
    section: "Import / Export",
    execute: () => open().openImportExport("import"),
  },
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
