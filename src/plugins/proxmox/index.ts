import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import { ProxmoxPanel } from "./components/ProxmoxPanel";
import { initProxmoxRuntime } from "./runtime";

export const manifest: PluginManifest = {
  id: "plugin-proxmox",
  name: "Proxmox LXC",
  version: "1.0.0",
  description: "Manage Proxmox VE LXC containers and snapshots over SSH.",
  permissions: ["sessions:read", "right-panel", "notifications"],
  defaultEnabled: true,
};

export const register: PluginRegisterFn = (api: PluginAPI) => {
  initProxmoxRuntime(api);
  return api.ui.registerRightPanelSection({
    id: "proxmox",
    label: "Proxmox LXC",
    icon: "devicon:proxmox-plain",
    component: ProxmoxPanel,
  });
};
