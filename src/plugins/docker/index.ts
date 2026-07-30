import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import manifestJson from "./manifest.json";
import { DockerPanel } from "./components/DockerPanel";
import { initDockerRuntime } from "./runtime";
import { createMobileDockerScreen } from "./components/MobileDockerScreen";
import { createMobileDockerLogsScreen } from "./components/MobileDockerLogsScreen";

export const manifest = manifestJson as PluginManifest;

export const register: PluginRegisterFn = (api: PluginAPI) => {
  initDockerRuntime(api);
  const offPanel = api.ui.registerRightPanelSection({
    id: "docker",
    label: "Docker",
    icon: "mdi:docker",
    component: DockerPanel,
  });
  const offMobile = api.ui.registerMobileScreen({
    id: "docker",
    kind: "docker",
    title: "Docker",
    render: createMobileDockerScreen(api),
  });
  const offMobileLogs = api.ui.registerMobileScreen({
    id: "docker-logs",
    kind: "docker-logs",
    title: "Docker logs",
    render: createMobileDockerLogsScreen(api),
  });
  return () => {
    offPanel();
    offMobile();
    offMobileLogs();
  };
};
