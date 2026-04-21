import type { OmniCommand } from "@/plugins/api";
import { useUIStore } from "@/stores/uiStore";

export const commands: OmniCommand[] = [
  {
    id: "core:new-theme",
    label: "Create Custom Theme",
    icon: "lucide:palette",
    keywords: ["theme", "color", "appearance", "style", "design", "custom"],
    section: "Actions",
    execute: () => useUIStore.getState().openThemeCreator(),
  },
];
