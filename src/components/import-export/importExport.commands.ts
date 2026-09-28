import type { OmniCommand } from "@/plugins/api";
import { useUIStore } from "@/stores/uiStore";
import { IMPORTERS } from "@/services/import-export/importers";
import { defineCommand } from "@/commands/defineCommand";
import { lazyT } from "@/i18n";

const open = useUIStore.getState;

const section = lazyT("omni.sections.importExport");

type IECommandDef = Omit<OmniCommand, "section">;

const ieCommand = (def: IECommandDef): OmniCommand => defineCommand({ ...def, section });

const importerCommands: OmniCommand[] = IMPORTERS.map(importer => ieCommand({
  id: `import-export:import-${importer.key}`,
  label: lazyT(
    importer.autoExtract ? "omni.commands.importFrom" : "omni.commands.importFromEllipsis",
    { label: importer.label },
  ),
  icon: importer.icon,
  keywords: ["import", importer.key, importer.label.toLowerCase(), "sessions", "hosts", "connections"],
  execute: () => open().openImportExport("import", {
    source: importer.key,
    autoTrigger: !!importer.autoExtract,
  }),
}));

export const commands: OmniCommand[] = [
  // ── Vault export ───────────────────────────────────────────────────────────
  ieCommand({
    id: "import-export:export-all",
    label: lazyT("omni.commands.exportAll"),
    icon: "lucide:upload",
    keywords: ["export", "backup", "save", "json", "csv", "download", "vault"],
    execute: () => open().openImportExport("export"),
  }),
  ieCommand({
    id: "import-export:export-connections",
    label: lazyT("omni.commands.exportConnections"),
    icon: "lucide:server",
    keywords: ["export", "connections", "hosts", "ssh"],
    execute: () => open().openImportExport("export", { preselectedTypes: ["connections"] }),
  }),
  ieCommand({
    id: "import-export:export-identities",
    label: lazyT("omni.commands.exportIdentities"),
    icon: "lucide:id-card",
    keywords: ["export", "identities", "users"],
    execute: () => open().openImportExport("export", { preselectedTypes: ["identities"] }),
  }),
  ieCommand({
    id: "import-export:export-keys",
    label: lazyT("omni.commands.exportKeys"),
    icon: "lucide:key",
    keywords: ["export", "keys", "ssh", "keychain"],
    execute: () => open().openImportExport("export", { preselectedTypes: ["keys"] }),
  }),
  ieCommand({
    id: "import-export:export-snippets",
    label: lazyT("omni.commands.exportSnippets"),
    icon: "lucide:braces",
    keywords: ["export", "snippets", "commands"],
    execute: () => open().openImportExport("export", { preselectedTypes: ["snippets"] }),
  }),
  ieCommand({
    id: "import-export:export-port-forwarding",
    label: lazyT("omni.commands.exportPortForwarding"),
    icon: "lucide:arrow-right-left",
    keywords: ["export", "port", "forwarding", "rules", "tunnel"],
    execute: () => open().openImportExport("export", { preselectedTypes: ["portForwardingRules"] }),
  }),
  // ── Vault import ───────────────────────────────────────────────────────────
  ...importerCommands,
  // ── User data ──────────────────────────────────────────────────────────────
  ieCommand({
    id: "import-export:export-themes",
    label: lazyT("omni.commands.exportThemes"),
    icon: "lucide:palette",
    keywords: ["export", "themes", "colors", "appearance"],
    execute: () => open().openThemeImportExport("export"),
  }),
  ieCommand({
    id: "import-export:import-themes",
    label: lazyT("omni.commands.importThemes"),
    icon: "lucide:palette",
    keywords: ["import", "themes", "colors", "appearance"],
    execute: () => open().openThemeImportExport("import"),
  }),
];
