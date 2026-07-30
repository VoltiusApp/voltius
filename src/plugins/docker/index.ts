import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import manifestJson from "./manifest.json";
import { DockerPanel } from "./components/DockerPanel";
import { initDockerRuntime } from "./runtime";

export const manifest = manifestJson as PluginManifest;

export const register: PluginRegisterFn = (api: PluginAPI) => {
  initDockerRuntime(api);
  return api.ui.registerRightPanelSection({
    id: "docker",
    label: "Docker",
    icon: "mdi:docker",
    component: DockerPanel,
  });
};
