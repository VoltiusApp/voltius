import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import { DockerPanel } from "./components/DockerPanel";

export const manifest: PluginManifest = {
  id: "plugin-docker",
  name: "Docker",
  version: "1.0.0",
  description: "Manage Docker containers, images, volumes, and networks for local and SSH sessions.",
  permissions: ["sessions:read", "right-panel"],
  defaultEnabled: true,
};

export const register: PluginRegisterFn = (api: PluginAPI) => {
  return api.ui.registerRightPanelSection({
    id: "docker",
    label: "Docker",
    icon: "mdi:docker",
    component: DockerPanel,
  });
};
