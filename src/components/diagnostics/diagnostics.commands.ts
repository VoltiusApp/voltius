import type { OmniCommand } from "@/plugins/api";
import { useUIStore } from "@/stores/uiStore";
import { defineCommand } from "@/commands/defineCommand";
import { lazyT } from "@/i18n";

export const commands: OmniCommand[] = [
  defineCommand({
    id: "core:report-bug",
    label: lazyT("omni.commands.reportBug"),
    icon: "lucide:bug",
    keywords: ["bug", "report", "log", "diagnostic", "issue", "debug"],
    execute: () => useUIStore.getState().openSettings("diagnostics"),
  }),
];
