import i18n from "@/i18n";
import type { PluginAPI, PluginManifest, PluginRegisterFn } from "@/plugins/api";
import { initAgent, shutdownAgent, useAgentStore } from "./state/agentStore";
import { installApprovalToasts } from "./state/approvalToasts";
import { buildTerminalContext } from "./state/touchpoint";
import { AiDrawer } from "./ui/AiDrawer";
import { AiTitleBarButton } from "./ui/AiTitleBarButton";
import { TerminalAskButton } from "./ui/TerminalAskButton";
import { createSettingsPage } from "./settings/SettingsPage";
import { openPanel, setPanelHandle } from "./panel";

const PANEL_ID = "drawer"; // prefixed → "plugin-ai-agent:drawer"

export const manifest: PluginManifest = {
  id: "plugin-ai-agent",
  name: "AI Agent",
  version: "1.0.0",
  description:
    "Bring-your-own-key AI assistant (Terminal Doctor). Reads terminal output and runs approved commands to help diagnose issues. Disableable; API keys stored locally in your OS keychain. The conversation, including any captured terminal output, is stored unencrypted on this device.",
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

  const panel = api.ui.registerGlobalPanel({ id: PANEL_ID, component: AiDrawer });
  setPanelHandle(panel);
  const offOmni = api.omni.register({
    id: "ask-ai",
    label: "Ask AI…",
    icon: "lucide:sparkles",
    keywords: ["ai", "assistant", "chat", "doctor"],
    keybinding: "ctrl+j",
    execute: openPanel,
  });
  const offAskTerminal = api.omni.register({
    id: "ask-ai-terminal",
    label: i18n.t("aiAgent.touchpoint.command"),
    icon: "lucide:sparkles",
    keywords: ["ai", "terminal", "explain", "diagnose"],
    keybinding: "ctrl+shift+j",
    execute: () => {
      const active = api.sessions.getActive();
      if (active) {
        const ctx = buildTerminalContext(api, active.id, active.connectionName ?? active.connectionId);
        if (ctx) useAgentStore.getState().attachContext(ctx);
      }
      openPanel();
    },
  });
  const offTerminalButton = api.ui.registerStatusBarItem("terminal.statusBar.right", (ctx) => (
    <TerminalAskButton sessionId={ctx.sessionId} connectionName={ctx.connectionName ?? ctx.connectionId} />
  ));
  const offTitlebar = api.ui.registerStatusBarItem("titlebar.right", () => <AiTitleBarButton />);
  // Registered INSIDE the isActive() guard, departing from the runtime's house
  // convention (settings pages normally register outside it so disabled
  // plugins stay configurable): this plugin's rule is "agent disabled → zero
  // extra UI anywhere", and the page's data access runs through
  // getAgentDeps(), which is non-null exactly while the plugin is active.
  const offSettings = api.ui.registerSettingsPage({
    id: "settings", // runtime prefixes → "plugin-ai-agent:settings"
    label: "AI Agent",
    icon: "lucide:sparkles",
    component: createSettingsPage(api),
  });
  const offToasts = installApprovalToasts(api);

  return () => {
    setPanelHandle(null);
    panel(); offOmni(); offAskTerminal(); offTerminalButton(); offTitlebar(); offSettings(); offToasts();
    // Agent-owned SSH sessions are intentionally left open here — closing
    // them is out of scope until the runtime's session-ownership story is
    // settled, and closing on teardown could race a session the user is
    // still looking at. Everything else (in-flight run, pending approvals,
    // deps) is torn down so a disabled plugin can't keep executing tools.
    shutdownAgent();
  };
};
