import { describe, expect, it, vi } from "vitest";
import type { PanePorts } from "./panes";
import { detach, focus, listTabs, moveToPane, PANE_ERRORS, splitWith } from "./panes";
import type { SplitTab, SplitPosition } from "@/stores/layoutStore";
import { splitGeometry } from "@/stores/layoutStore";

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
    toggleBroadcast: vi.fn(),
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
        { paneId: "session:sess-c", sessionId: "sess-c", connectionName: "lonely", active: false, maximized: false },
      ],
    });
  });

  it("marks the standalone tab and its one pane active only when no split tab is showing", () => {
    const ports = makePorts({ splitTabActive: vi.fn(() => false), activeSessionId: vi.fn(() => "sess-c") });
    const tabs = listTabs(ports);
    const sessC = tabs.find((t) => t.tabId === "session:sess-c");
    expect(sessC?.active).toBe(true);
    expect(sessC?.panes[0].active).toBe(true);
    expect(tabs.find((t) => t.tabId === "tab-1")?.active).toBe(false);
  });

  it("does not report every standalone pane as active (only the shown one)", () => {
    const ports = makePorts({
      splitTabs: vi.fn(() => []),
      sessions: vi.fn(() => [
        { id: "sess-a", connectionName: "web-01" },
        { id: "sess-c", connectionName: "lonely" },
      ]),
      splitTabActive: vi.fn(() => false),
      activeSessionId: vi.fn(() => "sess-a"),
    });
    const tabs = listTabs(ports);
    expect(tabs.map((t) => t.panes[0].active)).toEqual([true, false]);
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

  it("refuses when the target's tab has broadcast typing enabled", () => {
    const ports = makePorts({ splitTabs: vi.fn(() => [splitTab({ broadcastActive: true })]) });
    const result = splitWith(ports, { sessionId: "sess-c", targetSessionId: "sess-b", position: "bottom" });
    expect(result).toEqual({ ok: false, error: PANE_ERRORS.broadcastActive });
    expect(ports.splitPane).not.toHaveBeenCalled();
  });

  it("clears broadcast on a freshly created split tab that inherited it from the active tab", () => {
    const tabs: SplitTab[] = [];
    const ports = makePorts({
      splitTabs: vi.fn(() => tabs),
      activeSplitTabId: vi.fn(() => "tab-new"),
      createSplitTab: vi.fn(() => {
        tabs.push(splitTab({
          id: "tab-new",
          root: {
            type: "split", id: "s-new", direction: "h", ratio: 0.5,
            first: { type: "leaf", id: "p-new-a", sessionId: "sess-a" },
            second: { type: "leaf", id: "p-new-c", sessionId: "sess-c" },
          },
          broadcastActive: true, // inherited from the previously active tab
        }));
      }),
      toggleBroadcast: vi.fn(() => {
        tabs[0] = { ...tabs[0], broadcastActive: false };
      }),
    });
    const result = splitWith(ports, { sessionId: "sess-c", targetSessionId: "sess-a", position: "right" });
    expect(ports.toggleBroadcast).toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.ok && result.tab?.broadcastActive).toBe(false);
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
  it("moves within one tab with movePane and reports the resulting layout", () => {
    const tabs = [splitTab()];
    const ports = makePorts({
      splitTabs: vi.fn(() => tabs),
      movePane: vi.fn(() => {
        // Mirrors what the real store's movePane produces for source p-1
        // moved to "top" of target p-2: splitLeaf(target=p-2, removed=p-1, "top").
        tabs[0] = splitTab({
          root: {
            type: "split", id: "s-2", direction: "v", ratio: 0.5,
            first: { type: "leaf", id: "p-1", sessionId: "sess-a" },
            second: { type: "leaf", id: "p-2", sessionId: "sess-b" },
          },
          activePaneId: "p-1",
        });
      }),
    });
    const result = moveToPane(ports, { sessionId: "sess-a", targetSessionId: "sess-b", position: "top" });
    expect(ports.activateSplitTab).toHaveBeenCalledWith("tab-1");
    expect(ports.movePane).toHaveBeenCalledWith("p-1", "p-2", "top");
    expect(ports.detachPane).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    expect(result.ok && result.tab?.panes.map((p) => p.sessionId)).toEqual(["sess-a", "sess-b"]);
  });

  it("refuses a same-tab move the store silently ignored, even though both sessions were already together (postcondition, not precondition)", () => {
    // movePane is the default no-op mock: the tree stays direction "h" with
    // sess-a first, which does not satisfy position "top" (direction "v",
    // sess-a first). A verify that only checked "both sessions share a tab"
    // would pass here even though nothing moved.
    const result = moveToPane(makePorts(), { sessionId: "sess-a", targetSessionId: "sess-b", position: "top" });
    expect(result).toEqual({ ok: false, error: PANE_ERRORS.unchanged });
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
      detachPane: vi.fn(() => {
        tabs[0] = { ...tabs[0], root: { type: "leaf", id: "p-2", sessionId: "sess-b" }, activePaneId: "p-2" };
        return "sess-a";
      }),
      splitPane: vi.fn((targetPaneId: string, sessionId: string) => {
        tabs[1] = {
          ...tabs[1],
          root: {
            type: "split", id: "s-3", direction: "h", ratio: 0.5,
            first: { type: "leaf", id: "p-10", sessionId },
            second: { type: "leaf", id: targetPaneId, sessionId: "sess-z" },
          },
          activePaneId: "p-10",
        };
      }),
    });
    const result = moveToPane(ports, { sessionId: "sess-a", targetSessionId: "sess-z", position: "left" });
    expect(ports.detachPane).toHaveBeenCalledWith("p-1");
    expect(ports.splitPane).toHaveBeenCalledWith("p-9", "sess-a", "left");
    expect(result.ok).toBe(true);
    expect(result.ok && result.tab?.panes.map((p) => p.sessionId)).toEqual(["sess-a", "sess-z"]);
  });

  it("refuses a source that is in no split tab", () => {
    expect(moveToPane(makePorts(), { sessionId: "sess-c", targetSessionId: "sess-a", position: "right" }))
      .toEqual({ ok: false, error: PANE_ERRORS.notSplit });
  });

  it("refuses when the target's tab has broadcast typing enabled", () => {
    const ports = makePorts({ splitTabs: vi.fn(() => [splitTab({ broadcastActive: true })]) });
    const result = moveToPane(ports, { sessionId: "sess-a", targetSessionId: "sess-b", position: "top" });
    expect(result).toEqual({ ok: false, error: PANE_ERRORS.broadcastActiveSameTab });
    expect(ports.movePane).not.toHaveBeenCalled();
  });
});

describe("broadcast refusals name the right action", () => {
  const broadcasting = () =>
    makePorts({ splitTabs: vi.fn(() => [splitTab({ broadcastActive: true })]) });

  it("a move inside a broadcasting tab talks about moving, not placing", () => {
    const result = moveToPane(broadcasting(), {
      sessionId: "sess-a", targetSessionId: "sess-b", position: "right",
    });
    expect(result).toEqual({ ok: false, error: PANE_ERRORS.broadcastActiveSameTab });
  });

  it("a split into a broadcasting tab keeps the placement wording", () => {
    const result = splitWith(broadcasting(), {
      sessionId: "sess-c", targetSessionId: "sess-a", position: "right",
    });
    expect(result).toEqual({ ok: false, error: PANE_ERRORS.broadcastActive });
  });

  it("a cross-tab move into a broadcasting tab keeps the placement wording", () => {
    const source = splitTab({
      id: "tab-2",
      root: {
        type: "split", id: "s-2", direction: "h", ratio: 0.5,
        first: { type: "leaf", id: "p-3", sessionId: "sess-c" },
        second: { type: "leaf", id: "p-4", sessionId: "sess-d" },
      },
      broadcastActive: false,
    });
    const ports = makePorts({
      splitTabs: vi.fn(() => [splitTab({ broadcastActive: true }), source]),
      sessions: vi.fn(() => [
        { id: "sess-a", connectionName: "web-01" },
        { id: "sess-b", connectionName: "db-01" },
        { id: "sess-c", connectionName: "lonely" },
        { id: "sess-d", connectionName: "other" },
      ]),
    });
    const result = moveToPane(ports, {
      sessionId: "sess-c", targetSessionId: "sess-a", position: "right",
    });
    expect(result).toEqual({ ok: false, error: PANE_ERRORS.broadcastActive });
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
    let tab = splitTab({ activePaneId: "p-1" });
    const ports = makePorts({
      splitTabs: vi.fn(() => [tab]),
      setActivePane: vi.fn((paneId: string) => {
        tab = { ...tab, activePaneId: paneId };
      }),
    });
    const result = focus(ports, "sess-b");
    expect(ports.activateSplitTab).toHaveBeenCalledWith("tab-1");
    expect(ports.setActivePane).toHaveBeenCalledWith("p-2");
    expect(ports.revealActiveTab).toHaveBeenCalledWith("sess-b");
    expect(ports.setMaximized).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("maximizes and un-maximizes only when asked", () => {
    let onTab = splitTab({ activePaneId: "p-1", maximizedPaneId: null });
    const on = makePorts({
      splitTabs: vi.fn(() => [onTab]),
      setActivePane: vi.fn((paneId: string) => {
        onTab = { ...onTab, activePaneId: paneId };
      }),
      setMaximized: vi.fn((paneId: string | null) => {
        onTab = { ...onTab, maximizedPaneId: paneId };
      }),
    });
    focus(on, "sess-a", true);
    expect(on.setMaximized).toHaveBeenCalledWith("p-1");

    let offTab = splitTab({ activePaneId: "p-1", maximizedPaneId: "p-1" });
    const off = makePorts({
      splitTabs: vi.fn(() => [offTab]),
      setActivePane: vi.fn((paneId: string) => {
        offTab = { ...offTab, activePaneId: paneId };
      }),
      setMaximized: vi.fn((paneId: string | null) => {
        offTab = { ...offTab, maximizedPaneId: paneId };
      }),
    });
    focus(off, "sess-a", false);
    expect(off.setMaximized).toHaveBeenCalledWith(null);
  });

  it("focuses a standalone session through the titlebar path", () => {
    const ports = makePorts({ splitTabActive: vi.fn(() => false), activeSessionId: vi.fn(() => "sess-c") });
    const result = focus(ports, "sess-c");
    expect(ports.focusStandaloneTab).toHaveBeenCalledWith("sess-c");
    expect(result.ok && result.tab?.kind).toBe("session");
  });

  it("refuses maximize on a standalone session instead of silently no-op'ing", () => {
    const ports = makePorts({ splitTabActive: vi.fn(() => false), activeSessionId: vi.fn(() => "sess-c") });
    expect(focus(ports, "sess-c", true)).toEqual({ ok: false, error: PANE_ERRORS.noPaneToMaximize });
    expect(ports.focusStandaloneTab).not.toHaveBeenCalled();
  });

  it("still focuses a standalone session when maximize is false or omitted", () => {
    const ports = makePorts({ splitTabActive: vi.fn(() => false), activeSessionId: vi.fn(() => "sess-c") });
    expect(focus(ports, "sess-c", false).ok).toBe(true);
    expect(focus(ports, "sess-c", undefined).ok).toBe(true);
  });

  it("refuses an unknown session and the mobile shell", () => {
    expect(focus(makePorts(), "nope")).toEqual({ ok: false, error: PANE_ERRORS.noSession });
    expect(focus(makePorts({ isMobile: vi.fn(() => true) }), "sess-a"))
      .toEqual({ ok: false, error: PANE_ERRORS.mobile });
  });

  it("refuses when the store ignores setActivePane", () => {
    let tab = splitTab({ activePaneId: "p-1" });
    const ports = makePorts({
      splitTabs: vi.fn(() => [tab]),
      setActivePane: vi.fn(() => {
      }),
    });
    expect(focus(ports, "sess-b")).toEqual({ ok: false, error: PANE_ERRORS.unchanged });
  });
});

describe("splitGeometry", () => {
  it("maps each position to a direction and an order", () => {
    expect(splitGeometry("left")).toEqual({ direction: "h", incomingFirst: true });
    expect(splitGeometry("right")).toEqual({ direction: "h", incomingFirst: false });
    expect(splitGeometry("top")).toEqual({ direction: "v", incomingFirst: true });
    expect(splitGeometry("bottom")).toEqual({ direction: "v", incomingFirst: false });
  });

  it("verifies a same-tab move against the geometry the position implies", () => {
    const positions: SplitPosition[] = ["left", "right", "top", "bottom"];
    for (const position of positions) {
      const { direction, incomingFirst } = splitGeometry(position);
      const first = { type: "leaf" as const, id: "p-1", sessionId: incomingFirst ? "sess-c" : "sess-a" };
      const second = { type: "leaf" as const, id: "p-2", sessionId: incomingFirst ? "sess-a" : "sess-c" };
      const ports = makePorts({
        splitTabs: vi.fn(() => [splitTab({
          root: { type: "split", id: "s-1", direction, ratio: 0.5, first, second },
        })]),
      });
      const result = moveToPane(ports, { sessionId: "sess-c", targetSessionId: "sess-a", position });
      expect(result.ok).toBe(true);
    }
  });
});

