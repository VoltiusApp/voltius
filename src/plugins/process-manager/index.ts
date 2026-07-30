import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import manifestJson from "./manifest.json";
import { createProcessPanel } from "./components/ProcessPanel";
import { createMobileProcessesScreen } from "./components/MobileProcessesScreen";

export const manifest = manifestJson as PluginManifest;

export const register: PluginRegisterFn = (api: PluginAPI) => {
  const offPanel = api.ui.registerRightPanelSection({
    id: "processes",
    label: "Processes",
    icon: "lucide:cpu",
    component: createProcessPanel(api),
  });
  const offMobile = api.ui.registerMobileScreen({
    id: "processes",
    kind: "processes",
    title: "Processes",
    render: createMobileProcessesScreen(api),
  });
  return () => {
    offPanel();
    offMobile();
  };
};
