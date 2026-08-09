import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import manifestJson from "./manifest.json";
import { messages } from "./i18n";
import { ProxmoxPanel } from "./components/ProxmoxPanel";
import { initProxmoxRuntime } from "./runtime";
import { createMobileProxmoxScreen } from "./components/MobileProxmoxScreen";
import { buildProxmoxMcpTools } from "./mcpTools";

export const manifest = manifestJson as PluginManifest;

export const register: PluginRegisterFn = (api: PluginAPI) => {
  api.i18n.register(messages);
  initProxmoxRuntime(api);
  const offPanel = api.ui.registerRightPanelSection({
    id: "proxmox",
    label: () => api.i18n.t("title"),
    icon: "devicon:proxmox-plain",
    component: ProxmoxPanel,
    order: 30,
  });
  const offMobile = api.ui.registerMobileScreen({
    id: "proxmox",
    kind: "proxmox",
    render: createMobileProxmoxScreen(api),
  });
  const offMcp = api.mcp.registerTools(buildProxmoxMcpTools(api));
  return () => {
    offPanel();
    offMobile();
    offMcp();
  };
};
