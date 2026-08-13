import { describe, expect, it, vi } from "vitest";
import type { PanePorts } from "./panes";
import { detach, focus, listTabs, moveToPane, PANE_ERRORS, splitWith } from "./panes";
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

const soloTab = (id: string, paneId: string, sessionId: string): SplitTab => ({
  id, root: { type: "leaf", id: paneId, sessionId },
  activePaneId: paneId, maximizedPaneId: null, broadcastActive: false,
});

describe("splitWith", () => {
  it("creates a split tab when the target is standalone", () => {
    const ports = makePorts({ splitTabs: vi.fn(() => []) });
    const result = splitWith(ports, { sessionId: "sess-a", targetSessionId: "sess-c", position: "right" });
    expect(ports.createSplitTab).toHaveBeenCalledWith("sess-c", "sess-a", "right");
    expect(ports.splitPane).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: PANE_ERRORS.unchanged });
  });

  it("splits against the target's own pane when the target is already in a tab", () => {
    const tabs = [splitTab()];
    const ports = makePorts({
      splitTabs: vi.fn(() => tabs),
      splitPane: vi.fn((_t: string, sessionId: string) => {
        tabs[0] = splitTab({
          root: {
            type: "split", id: "s-2", direction: "h", ratio: 0.5,
            first: splitTab().root,
            second: { type: "leaf", id: "p-3", sessionId },
          },
        });
      }),
    });
    const result = splitWith(ports, { sessionId: "sess-c", targetSessionId: "sess-b", position: "bottom" });
    expect(ports.activateSplitTab).toHaveBeenCalledWith("tab-1");
    expect(ports.splitPane).toHaveBeenCalledWith("p-2", "sess-c", "bottom");
    expect(result.ok).toBe(true);
    expect(result.ok && result.tab?.panes.map((p) => p.sessionId)).toEqual(["sess-a", "sess-b", "sess-c"]);
  });

  it("refuses a session that is already in a split tab", () => {
    const ports = makePorts();
    expect(splitWith(ports, { sessionId: "sess-a", targetSessionId: "sess-c", position: "right" }))
      .toEqual({ ok: false, error: PANE_ERRORS.alreadySplit });
    expect(ports.splitPane).not.toHaveBeenCalled();
  });

  it("refuses unknown sessions, self-splits, and the mobile shell", () => {
    expect(splitWith(makePorts(), { sessionId: "nope", targetSessionId: "sess-b", position: "right" }))
      .toEqual({ ok: false, error: PANE_ERRORS.noSession });
    expect(splitWith(makePorts(), { sessionId: "sess-c", targetSessionId: "nope", position: "right" }))
      .toEqual({ ok: false, error: PANE_ERRORS.noSession });
    expect(splitWith(makePorts(), { sessionId: "sess-c", targetSessionId: "sess-c", position: "right" }))
      .toEqual({ ok: false, error: PANE_ERRORS.same });
    expect(splitWith(makePorts({ isMobile: vi.fn(() => true) }), { sessionId: "sess-c", targetSessionId: "sess-b", position: "right" }))
      .toEqual({ ok: false, error: PANE_ERRORS.mobile });
  });
});

describe("moveToPane", () => {
  it("moves within one tab with movePane", () => {
    const ports = makePorts();
    moveToPane(ports, { sessionId: "sess-a", targetSessionId: "sess-b", position: "top" });
    expect(ports.activateSplitTab).toHaveBeenCalledWith("tab-1");
    expect(ports.movePane).toHaveBeenCalledWith("p-1", "p-2", "top");
    expect(ports.detachPane).not.toHaveBeenCalled();
  });

  it("composes detach + attach across tabs, since the store has no cross-tab move", () => {
    const tabs = [splitTab(), soloTab("tab-2", "p-9", "sess-z")];
    const ports = makePorts({
      splitTabs: vi.fn(() => tabs),
      sessions: vi.fn(() => [
        { id: "sess-a", connectionName: "web-01" },
        { id: "sess-b", connectionName: "db-01" },
        { id: "sess-z", connectionName: "far" },
      ]),
    });
    moveToPane(ports, { sessionId: "sess-a", targetSessionId: "sess-z", position: "left" });
    expect(ports.detachPane).toHaveBeenCalledWith("p-1");
    expect(ports.splitPane).toHaveBeenCalledWith("p-9", "sess-a", "left");
  });

  it("refuses a source that is in no split tab", () => {
    expect(moveToPane(makePorts(), { sessionId: "sess-c", targetSessionId: "sess-a", position: "right" }))
      .toEqual({ ok: false, error: PANE_ERRORS.notSplit });
  });
});

describe("detach", () => {
  it("removes the leaf and reports the surviving tab", () => {
    const tabs = [splitTab()];
    const ports = makePorts({
      splitTabs: vi.fn(() => tabs),
      detachPane: vi.fn(() => {
        tabs[0] = splitTab({
          root: { type: "leaf", id: "p-2", sessionId: "sess-b" },
          activePaneId: "p-2",
        });
        return "sess-a";
      }),
    });
    const result = detach(ports, "sess-a");
    expect(ports.activateSplitTab).toHaveBeenCalledWith("tab-1");
    expect(ports.detachPane).toHaveBeenCalledWith("p-1");
    expect(result.ok && result.tab?.panes.map((p) => p.sessionId)).toEqual(["sess-b"]);
  });

  it("reports a null tab when the split tab collapsed", () => {
    const tabs: SplitTab[] = [splitTab()];
    const ports = makePorts({
      splitTabs: vi.fn(() => tabs),
      detachPane: vi.fn(() => { tabs.length = 0; return "sess-a"; }),
    });
    expect(detach(ports, "sess-a")).toEqual({ ok: true, tab: null });
  });

  it("refuses a session that is in no split tab, an unknown id, and mobile", () => {
    expect(detach(makePorts(), "sess-c")).toEqual({ ok: false, error: PANE_ERRORS.notSplit });
    expect(detach(makePorts(), "nope")).toEqual({ ok: false, error: PANE_ERRORS.noSession });
    expect(detach(makePorts({ isMobile: vi.fn(() => true) }), "sess-a"))
      .toEqual({ ok: false, error: PANE_ERRORS.mobile });
  });

  it("refuses when the store ignored the detach", () => {
    expect(detach(makePorts(), "sess-a")).toEqual({ ok: false, error: PANE_ERRORS.unchanged });
  });
});

describe("focus", () => {
  it("activates the owning tab and pane, and reveals it", () => {
    const ports = makePorts({ splitTabs: vi.fn(() => [splitTab({ activePaneId: "p-2" })]) });
    const result = focus(ports, "sess-b");
    expect(ports.activateSplitTab).toHaveBeenCalledWith("tab-1");
    expect(ports.setActivePane).toHaveBeenCalledWith("p-2");
    expect(ports.revealActiveTab).toHaveBeenCalledWith("sess-b");
    expect(ports.setMaximized).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("maximizes and un-maximizes only when asked", () => {
    const maxTab = () => splitTab({ activePaneId: "p-1", maximizedPaneId: "p-1" });
    const on = makePorts({ splitTabs: vi.fn(() => [maxTab()]) });
    focus(on, "sess-a", true);
    expect(on.setMaximized).toHaveBeenCalledWith("p-1");

    const off = makePorts({ splitTabs: vi.fn(() => [maxTab()]) });
    focus(off, "sess-a", false);
    expect(off.setMaximized).toHaveBeenCalledWith(null);
  });

  it("focuses a standalone session through the titlebar path", () => {
    const ports = makePorts({ splitTabActive: vi.fn(() => false), activeSessionId: vi.fn(() => "sess-c") });
    const result = focus(ports, "sess-c");
    expect(ports.focusStandaloneTab).toHaveBeenCalledWith("sess-c");
    expect(result.ok && result.tab?.kind).toBe("session");
  });

  it("refuses an unknown session and the mobile shell", () => {
    expect(focus(makePorts(), "nope")).toEqual({ ok: false, error: PANE_ERRORS.noSession });
    expect(focus(makePorts({ isMobile: vi.fn(() => true) }), "sess-a"))
      .toEqual({ ok: false, error: PANE_ERRORS.mobile });
  });
});

