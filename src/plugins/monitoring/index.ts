import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import { MetricsPanel } from "./components/MetricsPanel";

export const manifest: PluginManifest = {
  id: "plugin-monitoring",
  name: "System Metrics",
  version: "1.0.0",
  description: "Real-time CPU, RAM, network, and disk metrics for local and SSH sessions.",
  permissions: ["sessions:read", "right-panel"],
  defaultEnabled: true,
};

export const register: PluginRegisterFn = (api: PluginAPI) => {
  return api.ui.registerRightPanelSection({
    id: "monitoring",
    label: "Metrics",
    icon: "lucide:activity",
    component: MetricsPanel,
  });
};
