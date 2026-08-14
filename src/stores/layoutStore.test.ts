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
