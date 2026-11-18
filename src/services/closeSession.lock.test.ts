// @vitest-environment jsdom
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useLayoutStore, type SplitTab } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useLockNudgeStore } from "@/stores/lockNudgeStore";
import { useUIStore } from "@/stores/uiStore";
import type { TerminalSession } from "@/types";
import { closeSessionTabs, closeSplitTabSessions } from "./closeSession";

const session = (id: string, locked = false): TerminalSession => ({
  id, connectionId: "local", connectionName: id, status: "disconnected", type: "local", locked,
});

const split: SplitTab = {
  id: "T",
  root: {
    type: "split", id: "sp", direction: "h", ratio: 0.5,
    first: { type: "leaf", id: "p1", sessionId: "p1s" },
    second: { type: "leaf", id: "p2", sessionId: "p2s" },
  },
  activePaneId: "p2",
  maximizedPaneId: null,
  broadcastActive: false,
};

const ids = () => useSessionStore.getState().sessions.map((s) => s.id);

describe("closeSessionTabs with locked sessions", () => {
  beforeEach(() => {
    useSessionStore.setState({ sessions: [session("a", true), session("b")], activeSessionId: "a" });
    useLayoutStore.setState({ splitTabs: [], titlebarOrder: ["session:a", "session:b"], pinnedKeys: [], root: null, activeSplitTabId: null, splitTabActive: false });
    useNotificationStore.setState({ toasts: [] });
    useLockNudgeStore.setState({ nonce: 0, ids: [] });
  });

  test("closes unlocked sessions and keeps locked ones", () => {
    expect(closeSessionTabs(["a", "b"])).toMatchObject({ closed: ["b"], kept: ["a"] });
    expect(ids()).toEqual(["a"]);
  });

  test("nudges the kept sessions", () => {
    closeSessionTabs(["a", "b"]);
    expect(useLockNudgeStore.getState()).toMatchObject({ nonce: 1, ids: ["a"] });
  });

  test("does not nudge when nothing is kept", () => {
    closeSessionTabs(["b"]);
    expect(useLockNudgeStore.getState().nonce).toBe(0);
  });

  test("reports kept tabs with a toast only when asked", () => {
    closeSessionTabs(["a", "b"]);
    expect(useNotificationStore.getState().toasts).toHaveLength(0);
    useSessionStore.setState({ sessions: [session("a", true), session("c")] });
    closeSessionTabs(["a", "c"], { reportKept: true });
    expect(useNotificationStore.getState().toasts).toHaveLength(1);
  });

  test("settled resolves only once the closed sessions have disconnected", async () => {
    let release!: () => void;
    const disconnect = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    useSessionStore.setState({ sessions: [session("a", true), { ...session("c"), status: "connected" }], disconnect });
    const { settled } = closeSessionTabs(["a", "c"]);
    let done = false;
    void settled.then(() => { done = true; });
    await Promise.resolve();
    expect(disconnect).toHaveBeenCalledWith("c");
    expect(done).toBe(false);
    release();
    await settled;
    expect(done).toBe(true);
  });

  test("stays on the terminal view while locked tabs remain", () => {
    const leave = vi.spyOn(useUIStore.getState(), "leaveTerminal");
    useUIStore.setState({ leaveTerminal: leave });
    closeSessionTabs(["a", "b"]);
    expect(leave).not.toHaveBeenCalled();
  });
});

describe("closeSplitTabSessions", () => {
  beforeEach(() => {
    useLayoutStore.getState().hydrate({ splitTabs: [split], activeSplitTabId: "T", splitTabActive: true, titlebarOrder: ["session:x", "split:T"], pinnedKeys: [] });
    useNotificationStore.setState({ toasts: [] });
  });

  test("closes unlocked panes and keeps the locked one as a tab in the split's place", () => {
    useSessionStore.setState({ sessions: [session("x"), session("p1s", true), session("p2s")], activeSessionId: "p2s" });
    expect(closeSplitTabSessions("T")).toMatchObject({ closed: ["p2s"], kept: ["p1s"] });
    expect(ids()).toEqual(["x", "p1s"]);
    expect(useLayoutStore.getState().splitTabs).toEqual([]);
    expect(useLayoutStore.getState().titlebarOrder).toEqual(["session:x", "session:p1s"]);
    expect(useNotificationStore.getState().toasts).toHaveLength(1);
  });

  test("closes the whole split when no pane is locked", () => {
    useSessionStore.setState({ sessions: [session("x"), session("p1s"), session("p2s")], activeSessionId: "p2s" });
    expect(closeSplitTabSessions("T")).toMatchObject({ closed: ["p1s", "p2s"], kept: [] });
    expect(useLayoutStore.getState().titlebarOrder).not.toContain("split:T");
    expect(ids()).toEqual(["x"]);
  });

  test("focus moves to the kept locked pane, not to an unrelated tab", () => {
    useSessionStore.setState({ sessions: [session("p1s", true), session("p2s"), session("x")], activeSessionId: "p2s" });
    closeSplitTabSessions("T");
    expect(useSessionStore.getState().activeSessionId).toBe("p1s");
    expect(useLayoutStore.getState().splitTabActive).toBe(false);
  });
});
