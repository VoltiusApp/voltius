import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import manifestJson from "./manifest.json";
import { messages } from "./i18n";
import { createMetricsPanel } from "./components/MetricsPanel";
import { createMobileMetricsScreen } from "./components/MobileMetricsScreen";

export const manifest = manifestJson as PluginManifest;

export const register: PluginRegisterFn = (api: PluginAPI) => {
  api.i18n.register(messages);
  const offPanel = api.ui.registerRightPanelSection({
    id: "monitoring",
    label: "Metrics",
    icon: "lucide:activity",
    component: createMetricsPanel(api),
  });
  const offMobile = api.ui.registerMobileScreen({
    id: "monitoring",
    kind: "metrics",
    title: api.i18n.t("title"),
    render: createMobileMetricsScreen(api),
  });
  return () => {
    offPanel();
    offMobile();
  };
};
