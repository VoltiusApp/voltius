import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import manifestJson from "./manifest.json";
import { createProcessPanel } from "./components/ProcessPanel";

export const manifest = manifestJson as PluginManifest;

export const register: PluginRegisterFn = (api: PluginAPI) => {
  return api.ui.registerRightPanelSection({
    id: "processes",
    label: "Processes",
    icon: "lucide:cpu",
    component: createProcessPanel(api),
  });
};
