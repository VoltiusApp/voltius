import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { useMcpOwnershipStore } from "@/stores/mcpOwnershipStore";
import { useSessionStore } from "@/stores/sessionStore";
import { PaneHeader } from "./PaneHeader";
import type { TerminalSession } from "@/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) => (opts ? `${key} ${opts.client}` : key),
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/utils/icons", () => ({
  getConnectionIcon: () => null,
  getConnectionIconColor: () => null,
  getDistroColor: () => null,
  getDistroIcon: () => "lucide:server",
  getDistroLabel: () => "",
}));

const session: TerminalSession = {
  id: "s1", connectionId: "c1", connectionName: "web-1", status: "connected", type: "local",
};

beforeEach(() => {
  useMcpOwnershipStore.setState({ owners: {}, busy: {} });
  useSessionStore.setState({ sessions: [session], activeSessionId: "s1" });
});
afterEach(cleanup);

describe("PaneHeader MCP chip", () => {
  it("is absent for a user-opened session", () => {
    render(<PaneHeader paneId="p1" session={session} active />);
    expect(screen.queryByTestId("mcp-chip")).toBeNull();
  });

  it("names the client in the tooltip", () => {
    useMcpOwnershipStore.getState().claim("s1", { clientId: "c1", clientName: "Claude Code" });
    render(<PaneHeader paneId="p1" session={session} active />);
    expect(screen.getByTestId("mcp-chip").getAttribute("title")).toContain("Claude Code");
  });

  it("falls back when the client sent no name", () => {
    useMcpOwnershipStore.getState().claim("s1", { clientId: "c1", clientName: "" });
    render(<PaneHeader paneId="p1" session={session} active />);
    const title = screen.getByTestId("mcp-chip").getAttribute("title") ?? "";
    expect(title).not.toContain("undefined");
    expect(title.length).toBeGreaterThan(0);
  });
});
