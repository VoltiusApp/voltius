import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import manifestJson from "./manifest.json";
import { messages } from "./i18n";
import { createProcessPanel } from "./components/ProcessPanel";
import { createMobileProcessesScreen } from "./components/MobileProcessesScreen";

export const manifest = manifestJson as PluginManifest;

export const register: PluginRegisterFn = (api: PluginAPI) => {
  api.i18n.register(messages);
  const offPanel = api.ui.registerRightPanelSection({
    id: "processes",
    label: "Processes",
    icon: "lucide:cpu",
    component: createProcessPanel(api),
  });
  const offMobile = api.ui.registerMobileScreen({
    id: "processes",
    kind: "processes",
    title: api.i18n.t("title"),
    render: createMobileProcessesScreen(api),
  });
  return () => {
    offPanel();
    offMobile();
  };
};
