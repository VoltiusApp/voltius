import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import manifestJson from "./manifest.json";
import { messages } from "./i18n";
import { createMetricsPanel } from "./components/MetricsPanel";
import { createMobileMetricsScreen } from "./components/MobileMetricsScreen";
import { buildMonitoringMcpTools } from "./mcpTools";

export const manifest = manifestJson as PluginManifest;

export const register: PluginRegisterFn = (api: PluginAPI) => {
  api.i18n.register(messages);
  const offPanel = api.ui.registerRightPanelSection({
    id: "monitoring",
    label: () => api.i18n.t("title"),
    icon: "lucide:activity",
    component: createMetricsPanel(api),
    providesHostMetrics: true,
    order: 10,
  });
  const offMobile = api.ui.registerMobileScreen({
    id: "monitoring",
    kind: "metrics",
    render: createMobileMetricsScreen(api),
  });
  const offMcp = api.mcp.registerTools(buildMonitoringMcpTools(api));
  return () => {
    offPanel();
    offMobile();
    offMcp();
  };
};
