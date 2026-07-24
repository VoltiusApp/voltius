import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import { useUIStore } from "@/stores/uiStore";
import { initAgent } from "./state/agentStore";
import { AiDrawer } from "./ui/AiDrawer";
import { AiTitleBarButton } from "./ui/AiTitleBarButton";

const PANEL_ID = "drawer"; // prefixed → "plugin-ai-agent:drawer"

export const manifest: PluginManifest = {
  id: "plugin-ai-agent",
  name: "AI Agent",
  version: "1.0.0",
  description:
    "Bring-your-own-key AI assistant (Terminal Doctor). Reads terminal output and runs approved commands to help diagnose issues. Disableable; API keys stored locally in your OS keychain.",
  permissions: [
    "terminal:read", "terminal:stream", "keychain:read", "keychain:write",
    "sessions:write", "sessions:read", "connections:read", "http",
    "global-panel", "omni-commands", "ui-contributions", "notifications", "settings-page",
  ],
  defaultEnabled: false,
  desktopOnly: false,
};

export const register: PluginRegisterFn = (api: PluginAPI) => {
  if (!api.isActive()) return () => {};
  void initAgent(api);

  const offPanel = api.ui.registerGlobalPanel({ id: PANEL_ID, component: AiDrawer });
  const offOmni = api.omni.register({
    id: "ask-ai",
    label: "Ask AI…",
    icon: "lucide:sparkles",
    keywords: ["ai", "assistant", "chat", "doctor"],
    keybinding: "ctrl+j",
    execute: () => useUIStore.getState().setGlobalPanelOpen("plugin-ai-agent:drawer", true),
  });
  const offTitlebar = api.ui.registerStatusBarItem("titlebar.right", () => <AiTitleBarButton />);

  return () => { offPanel(); offOmni(); offTitlebar(); };
};
