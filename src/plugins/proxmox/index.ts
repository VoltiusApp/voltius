import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import manifestJson from "./manifest.json";
import { ProxmoxPanel } from "./components/ProxmoxPanel";
import { initProxmoxRuntime } from "./runtime";
import { createMobileProxmoxScreen } from "./components/MobileProxmoxScreen";

export const manifest = manifestJson as PluginManifest;

export const register: PluginRegisterFn = (api: PluginAPI) => {
  initProxmoxRuntime(api);
  const offPanel = api.ui.registerRightPanelSection({
    id: "proxmox",
    label: "Proxmox LXC",
    icon: "devicon:proxmox-plain",
    component: ProxmoxPanel,
  });
  const offMobile = api.ui.registerMobileScreen({
    id: "proxmox",
    kind: "proxmox",
    title: "Proxmox",
    render: createMobileProxmoxScreen(api),
  });
  return () => {
    offPanel();
    offMobile();
  };
};
