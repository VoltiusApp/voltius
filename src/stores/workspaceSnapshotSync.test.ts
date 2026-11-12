// @vitest-environment jsdom
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/hooks/useTerminal", () => ({ getScrollOffset: () => 0, subscribeTerminalScroll: () => () => {} }));
vi.mock("./toggleSettingsStore", () => ({ getToggle: () => true }));

const { startWorkspaceSnapshotSync, useWorkspaceSnapshotStore } = await import("./workspaceSnapshotStore");
const { useLayoutStore } = await import("./layoutStore");
const { useSessionStore } = await import("./sessionStore");

const saved = () => useWorkspaceSnapshotStore.getState().snapshot;

describe("workspace snapshot sync", () => {
  beforeAll(() => {
    vi.useFakeTimers();
    useSessionStore.setState({ sessions: [{ id: "a", connectionId: "local", connectionName: "a", status: "connected", type: "local" }] });
    useLayoutStore.setState({ splitTabs: [], titlebarOrder: ["session:a"], pinnedKeys: [], splitTabActive: false, activeSplitTabId: null });
    startWorkspaceSnapshotSync();
  });
  afterAll(() => vi.useRealTimers());
  beforeEach(() => {
    vi.runOnlyPendingTimers();
    useWorkspaceSnapshotStore.setState({ snapshot: null });
  });

  test("a pin is written immediately", () => {
    useLayoutStore.getState().setPinned("session:a", true);
    expect(saved()?.layout.pinnedKeys).toEqual(["session:a"]);
  });

  test("an unpin is written immediately", () => {
    useLayoutStore.getState().setPinned("session:a", false);
    expect(saved()?.layout.pinnedKeys).toEqual([]);
  });

  test("other layout churn stays debounced", () => {
    useLayoutStore.setState({ splitTabActive: true });
    expect(saved()).toBeNull();
    vi.advanceTimersByTime(500);
    expect(saved()).not.toBeNull();
  });
});
