import { beforeEach, describe, expect, test } from "vitest";
import { broadcastActiveForSession, useLayoutStore, type PaneNode } from "./layoutStore";

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
