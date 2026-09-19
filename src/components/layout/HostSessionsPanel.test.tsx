import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { useUIStore } from "@/stores/uiStore";
import { HostSessionsPanel } from "./HostSessionsPanel";

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    startDragging: vi.fn(),
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/icons", () => ({ getConnectionIcon: () => null, getConnectionIconColor: () => null }));

const s = (id: string, connectionId: string, extra = {}) => ({ id, connectionId, connectionName: connectionId, status: "connected" as const, type: "ssh" as const, ...extra });

beforeEach(() => {
  useUIStore.setState({ activeNav: "terminal", sftpPanelOpen: false, hostPanelPinned: true });
  useSessionStore.setState({ sessions: [s("w1", "web"), s("w2", "web"), s("d1", "db")], activeSessionId: "w1" });
  useLayoutStore.setState({ splitTabs: [], root: null, splitTabActive: false, titlebarOrder: ["session:w1", "session:w2", "session:d1"] });
});
afterEach(cleanup);

describe("HostSessionsPanel", () => {
  it("lists the active host's sessions with numbering", () => {
    render(<HostSessionsPanel />);
    const rows = within(screen.getByTestId("host-sessions-rows"));
    expect(rows.getByText("web")).toBeTruthy();
    expect(rows.getByText("web (2)")).toBeTruthy();
    expect(rows.queryByText("db")).toBeNull();
  });

  it("stays for a host with one session", () => {
    useSessionStore.setState({ activeSessionId: "d1" });
    render(<HostSessionsPanel />);
    expect(screen.getByTestId("host-sessions-panel")).toBeTruthy();
  });

  it("is hidden when unpinned, outside terminal view, or on the SFTP page", () => {
    for (const state of [{ hostPanelPinned: false }, { activeNav: "hosts" as const }, { sftpPanelOpen: true }]) {
      useUIStore.setState({ activeNav: "terminal", sftpPanelOpen: false, hostPanelPinned: true, ...state });
      const { unmount } = render(<HostSessionsPanel />);
      expect(screen.queryByTestId("host-sessions-panel")).toBeNull();
      unmount();
    }
  });

  it("unpins from its header", () => {
    render(<HostSessionsPanel />);
    fireEvent.click(screen.getByTitle("layout.titleBar.stack.unpin"));
    expect(useUIStore.getState().hostPanelPinned).toBe(false);
  });

  it("marks a session that lives in a split and focuses its pane on click", () => {
    useLayoutStore.getState().createSplitTab("d1", "w2", "right");
    useSessionStore.setState({ activeSessionId: "w1" });
    render(<HostSessionsPanel />);
    fireEvent.click(screen.getByText("web (2)"));
    expect(useLayoutStore.getState().splitTabActive).toBe(true);
    expect(useSessionStore.getState().activeSessionId).toBe("w2");
  });
});
