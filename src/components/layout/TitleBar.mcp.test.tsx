import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useMcpOwnershipStore } from "@/stores/mcpOwnershipStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";
import TitleBar from "./TitleBar";

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
vi.mock("@/utils/icons", () => ({
  getConnectionIcon: () => null,
  getConnectionIconColor: () => null,
}));

const session = (id: string) => ({
  id, connectionId: `conn-${id}`, connectionName: id, status: "connected" as const, type: "local" as const,
});

beforeEach(() => {
  useMcpOwnershipStore.setState({ owners: {}, busy: {} });
  useSessionStore.setState({ sessions: [session("s1"), session("s2")], activeSessionId: "s1" });
});
afterEach(cleanup);

describe("MCP marking in the tab strip", () => {
  it("marks only the owned tab", () => {
    useMcpOwnershipStore.getState().claim("s2", { clientId: "c1", clientName: "Claude Code" });
    render(<TitleBar />);
    expect(screen.queryByTestId("mcp-bar-s1")).toBeNull();
    expect(screen.getByTestId("mcp-bar-s2")).toBeTruthy();
  });

  it("pulses only while a call is in flight", () => {
    useMcpOwnershipStore.getState().claim("s2", { clientId: "c1", clientName: "Claude Code" });
    const { rerender } = render(<TitleBar />);
    expect(screen.getByTestId("mcp-bar-s2").className).not.toContain("mcp-pulse");
    useMcpOwnershipStore.getState().beginActivity("s2");
    rerender(<TitleBar />);
    expect(screen.getByTestId("mcp-bar-s2").className).toContain("mcp-pulse");
  });

  it("marks a split tab when any pane inside it is owned", () => {
    useLayoutStore.getState().createSplitTab("s1", "s2", "right");
    useMcpOwnershipStore.getState().claim("s2", { clientId: "c1", clientName: "Claude Code" });
    render(<TitleBar />);
    const tabId = useLayoutStore.getState().splitTabs[0].id;
    expect(screen.getByTestId(`mcp-bar-${tabId}`)).toBeTruthy();
  });
});
