import { describe, expect, it, vi } from "vitest";
import type { PanePorts } from "./panes";
import { listTabs } from "./panes";
import type { SplitTab } from "@/stores/layoutStore";

export const splitTab = (over: Partial<SplitTab> = {}): SplitTab => ({
  id: "tab-1",
  root: {
    type: "split", id: "s-1", direction: "h", ratio: 0.5,
    first: { type: "leaf", id: "p-1", sessionId: "sess-a" },
    second: { type: "leaf", id: "p-2", sessionId: "sess-b" },
  },
  activePaneId: "p-1",
  maximizedPaneId: null,
  broadcastActive: false,
  ...over,
});

export function makePorts(over: Partial<PanePorts> = {}): PanePorts {
  return {
    splitTabs: vi.fn(() => [splitTab()]),
    activeSplitTabId: vi.fn(() => "tab-1"),
    splitTabActive: vi.fn(() => true),
    sessions: vi.fn(() => [
      { id: "sess-a", connectionName: "web-01" },
      { id: "sess-b", connectionName: "db-01" },
      { id: "sess-c", connectionName: "lonely" },
    ]),
    activeSessionId: vi.fn(() => "sess-a"),
    activateSplitTab: vi.fn(),
    createSplitTab: vi.fn(),
    splitPane: vi.fn(),
    movePane: vi.fn(),
    detachPane: vi.fn(() => null),
    setActivePane: vi.fn(),
    setMaximized: vi.fn(),
    focusStandaloneTab: vi.fn(),
    revealActiveTab: vi.fn(),
    isMobile: vi.fn(() => false),
    ...over,
  };
}

describe("listTabs", () => {
  it("projects a split tab as one entry with a pane per leaf, in tree order", () => {
    const [tab] = listTabs(makePorts());
    expect(tab).toEqual({
      tabId: "tab-1",
      kind: "split",
      active: true,
      broadcastActive: false,
      layout: splitTab().root,
      panes: [
        { paneId: "p-1", sessionId: "sess-a", connectionName: "web-01", active: true, maximized: false },
        { paneId: "p-2", sessionId: "sess-b", connectionName: "db-01", active: false, maximized: false },
      ],
    });
  });

  it("projects a session held by no split tab as a single-pane tab", () => {
    const tabs = listTabs(makePorts());
    expect(tabs).toHaveLength(2);
    expect(tabs[1]).toEqual({
      tabId: "session:sess-c",
      kind: "session",
      active: false,
      broadcastActive: false,
      layout: null,
      panes: [
        { paneId: "session:sess-c", sessionId: "sess-c", connectionName: "lonely", active: true, maximized: false },
      ],
    });
  });

  it("marks the standalone tab active only when no split tab is showing", () => {
    const ports = makePorts({ splitTabActive: vi.fn(() => false), activeSessionId: vi.fn(() => "sess-c") });
    const tabs = listTabs(ports);
    expect(tabs.find((t) => t.tabId === "session:sess-c")?.active).toBe(true);
    expect(tabs.find((t) => t.tabId === "tab-1")?.active).toBe(false);
  });

  it("reports the maximized pane", () => {
    const ports = makePorts({ splitTabs: vi.fn(() => [splitTab({ maximizedPaneId: "p-2" })]) });
    expect(listTabs(ports)[0].panes.map((p) => p.maximized)).toEqual([false, true]);
  });
});
