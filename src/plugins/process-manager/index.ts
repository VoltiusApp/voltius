import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import manifestJson from "./manifest.json";
import { messages } from "./i18n";
import { createProcessPanel } from "./components/ProcessPanel";
import { createMobileProcessesScreen } from "./components/MobileProcessesScreen";
import { buildProcessMcpTools } from "./mcpTools";

export const manifest = manifestJson as PluginManifest;

export const register: PluginRegisterFn = (api: PluginAPI) => {
  api.i18n.register(messages);
  const offPanel = api.ui.registerRightPanelSection({
    id: "processes",
    label: () => api.i18n.t("title"),
    icon: "lucide:cpu",
    component: createProcessPanel(api),
    order: 40,
  });
  const offMobile = api.ui.registerMobileScreen({
    id: "processes",
    kind: "processes",
    render: createMobileProcessesScreen(api),
  });
  const offMcp = api.mcp.registerTools(buildProcessMcpTools(api));
  return () => {
    offPanel();
    offMobile();
    offMcp();
  };
};
