import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import RightPanel from "./RightPanel";
import { usePluginStore } from "@/stores/pluginStore";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";

// A `plugin:*` right-panel selection is persisted, so it outlives the plugin that
// registered the section. Uninstalling or disabling that plugin used to leave the
// panel open and completely empty, with no rail tab highlighted.

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/terminal/SnippetsPanel", () => ({ SnippetsPanel: () => <div>snippets-panel</div> }));
vi.mock("@/components/terminal/PortsPanel", () => ({ PortsPanel: () => <div>ports-panel</div> }));
vi.mock("@/components/terminal/HistoryPanel", () => ({ HistoryPanel: () => <div>history-panel</div> }));
vi.mock("@/components/terminal/PanelSftpSection", () => ({ default: () => <div>sftp-panel</div> }));
vi.mock("@/hooks/useCurrentSessionTunnelCount", () => ({ useCurrentSessionTunnelCount: () => 0 }));

function renderPanel(rightPanelSection: string) {
  useUIStore.setState({ rightPanelOpen: true, rightPanelSection, activeNav: "terminal" });
  useSessionStore.setState({
    sessions: [{ id: "s1", status: "connected", connectionId: "c1", connectionName: "c", type: "ssh" }],
    activeSessionId: "s1",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
  return render(<RightPanel />);
}

describe("RightPanel with a stale plugin:* selection", () => {
  beforeEach(() => {
    usePluginStore.setState({ rightPanelSections: new Map() });
  });
  afterEach(cleanup);

  test("renders the unavailable placeholder instead of nothing", () => {
    renderPanel("plugin:plugin-gone:panel");
    expect(screen.getByText("terminal.rightPanel.pluginUnavailable")).toBeTruthy();
  });

  test("the placeholder's action restores a built-in section", () => {
    renderPanel("plugin:plugin-gone:panel");
    fireEvent.click(screen.getByText("terminal.rightPanel.pluginUnavailableAction"));
    expect(useUIStore.getState().rightPanelSection).toBe("themes");
  });

  test("a resolving plugin section still renders its own component", () => {
    usePluginStore.setState({
      rightPanelSections: new Map([
        ["plugin-live:panel", {
          id: "plugin-live:panel",
          label: "Live",
          component: () => <div>live-plugin-panel</div>,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any],
      ]),
    });
    renderPanel("plugin:plugin-live:panel");
    expect(screen.getByText("live-plugin-panel")).toBeTruthy();
    expect(screen.queryByText("terminal.rightPanel.pluginUnavailable")).toBeNull();
  });
});
