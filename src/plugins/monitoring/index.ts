import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import manifestJson from "./manifest.json";
import { messages } from "./i18n";
import { createMetricsPanel } from "./components/MetricsPanel";
import { createMobileMetricsScreen } from "./components/MobileMetricsScreen";
import { buildMonitoringMcpTools } from "./mcpTools";
import { createMetricsService } from "./services";
import { createHostMetricsHub } from "./hostMetricsHub";

export const manifest = manifestJson as PluginManifest;

export const register: PluginRegisterFn = (api: PluginAPI) => {
  api.i18n.register(messages);
  const hub = createHostMetricsHub(createMetricsService(api.metrics), api.sessions);
  const offPanel = api.ui.registerRightPanelSection({
    id: "monitoring",
    label: () => api.i18n.t("title"),
    icon: "lucide:activity",
    component: createMetricsPanel(api, hub),
    providesHostMetrics: true,
    order: 10,
  });
  const offMobile = api.ui.registerMobileScreen({
    id: "monitoring",
    kind: "metrics",
    render: createMobileMetricsScreen(api, hub),
  });
  const offMcp = api.mcp.registerTools(buildMonitoringMcpTools(api));
  return () => {
    offPanel();
    offMobile();
    offMcp();
    hub.dispose();
  };
};
