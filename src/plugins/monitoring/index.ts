import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import manifestJson from "./manifest.json";
import { createMetricsPanel } from "./components/MetricsPanel";

export const manifest = manifestJson as PluginManifest;

export const register: PluginRegisterFn = (api: PluginAPI) => {
  return api.ui.registerRightPanelSection({
    id: "monitoring",
    label: "Metrics",
    icon: "lucide:activity",
    component: createMetricsPanel(api),
  });
};
