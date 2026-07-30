import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import manifestJson from "./manifest.json";
import { ProxmoxPanel } from "./components/ProxmoxPanel";
import { initProxmoxRuntime } from "./runtime";

export const manifest = manifestJson as PluginManifest;

export const register: PluginRegisterFn = (api: PluginAPI) => {
  initProxmoxRuntime(api);
  return api.ui.registerRightPanelSection({
    id: "proxmox",
    label: "Proxmox LXC",
    icon: "devicon:proxmox-plain",
    component: ProxmoxPanel,
  });
};
