import { beforeEach, describe, expect, test } from "vitest";
import { useLayoutStore, type SplitTab } from "./layoutStore";

const splitT: SplitTab = {
  id: "T",
  root: {
    type: "split",
    id: "sp",
    direction: "h",
    ratio: 0.5,
    first: { type: "leaf", id: "p1", sessionId: "s1" },
    second: { type: "leaf", id: "p2", sessionId: "s2" },
  },
  activePaneId: "p2",
  maximizedPaneId: null,
  broadcastActive: false,
};

const reset = () =>
  useLayoutStore.setState({
    root: null, activePaneId: null, maximizedPaneId: null, broadcastActive: false,
    splitTabActive: false, splitTabs: [], activeSplitTabId: null, titlebarOrder: [], pinnedKeys: [],
  });

const withPinnedSplit = () => {
  useLayoutStore.getState().hydrate({
    splitTabs: [splitT],
    activeSplitTabId: "T",
    splitTabActive: true,
    titlebarOrder: ["session:a", "split:T", "session:b"],
    pinnedKeys: ["split:T"],
  });
};

describe("pinned titlebar keys", () => {
  beforeEach(reset);

  test("setPinned adds once and removes", () => {
    const { setPinned } = useLayoutStore.getState();
    setPinned("session:s1", true);
    setPinned("session:s1", true);
    expect(useLayoutStore.getState().pinnedKeys).toEqual(["session:s1"]);
    setPinned("session:s1", false);
    expect(useLayoutStore.getState().pinnedKeys).toEqual([]);
  });

  test("a split created from a pinned tab is pinned", () => {
    useLayoutStore.getState().setPinned("session:s1", true);
    useLayoutStore.getState().createSplitTab("s1", "s2", "right");
    const tab = useLayoutStore.getState().splitTabs[0];
    expect(useLayoutStore.getState().pinnedKeys).toContain(`split:${tab.id}`);
  });

  test("a split collapsing on removeSession hands its place and pin to the survivor", () => {
    withPinnedSplit();
    useLayoutStore.getState().removeSession("s2");
    const state = useLayoutStore.getState();
    expect(state.titlebarOrder).toEqual(["session:a", "session:s1", "session:b"]);
    expect(state.pinnedKeys).toEqual(["session:s1"]);
  });

  test("a split collapsing on detachPane hands its place and pin to the remaining pane only", () => {
    withPinnedSplit();
    const detached = useLayoutStore.getState().detachPane("p2");
    const state = useLayoutStore.getState();
    expect(detached).toBe("s2");
    expect(state.titlebarOrder).toEqual(["session:a", "session:s1", "session:b"]);
    expect(state.pinnedKeys).toEqual(["session:s1"]);
  });

  test("closing a split tab or removing a session drops its pin", () => {
    withPinnedSplit();
    useLayoutStore.getState().setPinned("session:x", true);
    useLayoutStore.getState().closeSplitTab("T");
    expect(useLayoutStore.getState().pinnedKeys).toEqual(["session:x"]);
    useLayoutStore.getState().removeSession("x");
    expect(useLayoutStore.getState().pinnedKeys).toEqual([]);
  });
});
