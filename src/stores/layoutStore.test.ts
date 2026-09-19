import { beforeEach, describe, expect, test } from "vitest";
import { broadcastActiveForSession, getPaneSessionIds, useLayoutStore, type PaneNode, type SplitTab } from "./layoutStore";

const twoPanes: PaneNode = {
  type: "split",
  id: "sp1",
  direction: "h",
  ratio: 0.5,
  first: { type: "leaf", id: "p1", sessionId: "s1" },
  second: { type: "leaf", id: "p2", sessionId: "s2" },
};

describe("broadcastActiveForSession", () => {
  beforeEach(() => {
    useLayoutStore.setState({ root: twoPanes, broadcastActive: true, splitTabActive: true });
  });

  test("is false when broadcast is off", () => {
    useLayoutStore.setState({ broadcastActive: false });
    expect(broadcastActiveForSession("s1")).toBe(false);
  });

  test("is false for a session that is not a pane of the active split tab", () => {
    expect(broadcastActiveForSession("s3")).toBe(false);
  });

  test("is false when the split tab is not the active view", () => {
    useLayoutStore.setState({ splitTabActive: false });
    expect(broadcastActiveForSession("s1")).toBe(false);
  });

  test("is true for a pane of the active split tab with broadcast on", () => {
    expect(broadcastActiveForSession("s1")).toBe(true);
    expect(broadcastActiveForSession("s2")).toBe(true);
  });
});

describe("renameSplitTab", () => {
  beforeEach(() => {
    useLayoutStore.setState({
      splitTabs: [
        { id: "t1", root: twoPanes, activePaneId: "p1", maximizedPaneId: null, broadcastActive: false },
        { id: "t2", root: twoPanes, activePaneId: "p1", maximizedPaneId: null, broadcastActive: false },
      ],
      activeSplitTabId: "t1",
    });
  });

  const names = () => useLayoutStore.getState().splitTabs.map((tab) => tab.name);

  test("names the tab it is given, not the active one", () => {
    useLayoutStore.getState().renameSplitTab("t2", "prod");
    expect(names()).toEqual([undefined, "prod"]);
  });

  test("stores what the user typed, trimmed", () => {
    useLayoutStore.getState().renameSplitTab("t1", "  prod  ");
    expect(names()[0]).toBe("prod");
  });

  test("a blank name returns the tab to deriving from its active pane", () => {
    useLayoutStore.getState().renameSplitTab("t1", "prod");
    useLayoutStore.getState().renameSplitTab("t1", "");
    expect(names()[0]).toBeUndefined();
  });
});

const splitSessionIds = () => useLayoutStore.getState().splitTabs.flatMap((tab) => getPaneSessionIds(tab.root));

describe("one split tab per session", () => {
  beforeEach(() => {
    useLayoutStore.setState({ splitTabs: [], root: null, activeSplitTabId: null, activePaneId: null, splitTabActive: false, titlebarOrder: [] });
  });

  test("openSessions builds no tab around a session already in a split, and focuses it instead", () => {
    useLayoutStore.getState().createSplitTab("a1", "a2", "right");
    const t1 = useLayoutStore.getState().splitTabs[0]!;
    useLayoutStore.getState().createSplitTab("c1", "c2", "right");

    useLayoutStore.getState().openSessions(["a1", "b1"]);
    expect(useLayoutStore.getState().splitTabs).toHaveLength(2);
    expect(useLayoutStore.getState().activeSplitTabId).toBe(t1.id);
    expect(splitSessionIds().filter((id) => id === "a1")).toHaveLength(1);

    useLayoutStore.getState().openSessions(["a1", "b1", "b2"]);
    expect(getPaneSessionIds(useLayoutStore.getState().root)).toEqual(["b1", "b2"]);
    expect(new Set(splitSessionIds()).size).toBe(splitSessionIds().length);
  });

  test("hydrate drops a session's second pane from an older corrupted snapshot", () => {
    const tab = (id: string, a: string, b: string): SplitTab => ({
      id, activePaneId: `${id}-p2`, maximizedPaneId: null, broadcastActive: false,
      root: { type: "split", id: `${id}-sp`, direction: "h", ratio: 0.5, first: { type: "leaf", id: `${id}-p1`, sessionId: a }, second: { type: "leaf", id: `${id}-p2`, sessionId: b } },
    });
    const three = (): SplitTab => ({
      ...tab("t3", "c1", "a2"),
      root: { type: "split", id: "t3-sp", direction: "h", ratio: 0.5, first: tab("t3", "c1", "a2").root, second: { type: "leaf", id: "t3-p3", sessionId: "c2" } },
    });
    useLayoutStore.getState().hydrate({
      splitTabs: [tab("t1", "a1", "a2"), tab("t2", "b1", "a1"), three()],
      activeSplitTabId: "t2", splitTabActive: true, titlebarOrder: ["split:t1", "split:t2", "split:t3"],
    });

    const state = useLayoutStore.getState();
    expect(state.splitTabs.map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(getPaneSessionIds(state.splitTabs[1]!.root)).toEqual(["c1", "c2"]);
    expect(state.splitTabs[1]!.activePaneId).toBe("t3-p1");
    expect(new Set(splitSessionIds()).size).toBe(splitSessionIds().length);
    expect(state.activeSplitTabId).toBe("t3");
  });
});
