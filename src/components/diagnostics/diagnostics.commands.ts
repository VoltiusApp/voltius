import type { OmniCommand } from "@/plugins/api";
import { useUIStore } from "@/stores/uiStore";

export const commands: OmniCommand[] = [
  {
    id: "core:report-bug",
    label: "Report a bug",
    icon: "lucide:bug",
    keywords: ["bug", "report", "log", "diagnostic", "issue", "debug"],
    section: "Actions",
    execute: () => useUIStore.getState().openSettings("diagnostics"),
  },
];
