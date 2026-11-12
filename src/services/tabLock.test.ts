// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { useLayoutStore, type SplitTab } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { TerminalSession } from "@/types";
import { isPinnedKey, isSessionLocked, sessionsPinnedFirst, setTabLocked, splitTabLocked, titlebarKeyOfSession } from "./tabLock";

const session = (id: string): TerminalSession => ({ id, connectionId: "local", connectionName: id, status: "connected", type: "local" });

const tab: SplitTab = {
  id: "T",
  root: {
    type: "split", id: "sp", direction: "h", ratio: 0.5,
    first: { type: "leaf", id: "p1", sessionId: "s1" },
    second: { type: "leaf", id: "p2", sessionId: "s2" },
  },
  activePaneId: "p1",
  maximizedPaneId: null,
  broadcastActive: false,
};

describe("tab lock", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [session("s1"), session("s2"), session("s3")], activeSessionId: "s1" });
    useLayoutStore.setState({ splitTabs: [tab], pinnedKeys: [] });
  });

  test("locking a split locks every pane", () => {
    setTabLocked({ kind: "split", id: "T" }, true);
    expect(isSessionLocked("s1")).toBe(true);
    expect(isSessionLocked("s2")).toBe(true);
    expect(isSessionLocked("s3")).toBe(false);
  });

  test("a split is locked when any pane is locked", () => {
    expect(splitTabLocked(tab)).toBe(false);
    setTabLocked({ kind: "session", id: "s2" }, true);
    expect(splitTabLocked(tab)).toBe(true);
    setTabLocked({ kind: "split", id: "T" }, false);
    expect(splitTabLocked(tab)).toBe(false);
  });

  test("unknown sessions are not locked", () => {
    expect(isSessionLocked("nope")).toBe(false);
  });

  test("titlebar key and pin follow the split a session lives in", () => {
    expect(titlebarKeyOfSession("s1")).toBe("split:T");
    expect(titlebarKeyOfSession("s3")).toBe("session:s3");
    useLayoutStore.getState().setPinned("split:T", true);
    expect(isPinnedKey("split:T")).toBe(true);
    expect(isPinnedKey("session:s3")).toBe(false);
  });

  test("sessions come pinned first, including panes of a pinned split", () => {
    useLayoutStore.getState().setPinned("session:s3", true);
    expect(sessionsPinnedFirst(useSessionStore.getState().sessions).map((s) => s.id)).toEqual(["s3", "s1", "s2"]);
    useLayoutStore.getState().setPinned("split:T", true);
    expect(sessionsPinnedFirst(useSessionStore.getState().sessions).map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });
});
