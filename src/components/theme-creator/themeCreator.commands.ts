import type { OmniCommand } from "@/plugins/api";
import { useUIStore } from "@/stores/uiStore";
import { defineCommand } from "@/commands/defineCommand";
import { lazyT } from "@/i18n";

export const commands: OmniCommand[] = [
  defineCommand({
    id: "core:new-theme",
    label: lazyT("omni.commands.createTheme"),
    icon: "lucide:palette",
    keywords: ["theme", "color", "appearance", "style", "design", "custom"],
    execute: () => useUIStore.getState().openThemeCreator(),
  }),
];
