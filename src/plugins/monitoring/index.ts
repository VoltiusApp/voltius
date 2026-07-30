import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import manifestJson from "./manifest.json";
import { createMetricsPanel } from "./components/MetricsPanel";
import { createMobileMetricsScreen } from "./components/MobileMetricsScreen";

export const manifest = manifestJson as PluginManifest;

export const register: PluginRegisterFn = (api: PluginAPI) => {
  const offPanel = api.ui.registerRightPanelSection({
    id: "monitoring",
    label: "Metrics",
    icon: "lucide:activity",
    component: createMetricsPanel(api),
  });
  const offMobile = api.ui.registerMobileScreen({
    id: "monitoring",
    kind: "metrics",
    title: "Metrics",
    render: createMobileMetricsScreen(api),
  });
  return () => {
    offPanel();
    offMobile();
  };
};
