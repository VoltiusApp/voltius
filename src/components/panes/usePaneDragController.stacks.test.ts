import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePaneDragController } from "./usePaneDragController";
import { useDragStore } from "@/stores/dragStore";
import { findLeafBySession, useLayoutStore } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useToggleSettingsStore } from "@/stores/toggleSettingsStore";

const s = (id: string, connectionId: string) => ({ id, connectionId, connectionName: connectionId, status: "connected", type: "ssh" }) as never;

function drop(target: { targetKey: string | null; placement: "before" | "after" }) {
  act(() => {
    useDragStore.setState({ isDragging: true, dropTarget: { type: "titlebar", ...target } });
    window.dispatchEvent(new MouseEvent("mouseup"));
  });
}

beforeEach(() => {
  useToggleSettingsStore.setState({ values: {} });
  useSessionStore.setState({ sessions: [s("w1", "web"), s("w2", "web"), s("d1", "db"), s("x1", "x")], activeSessionId: "w1" });
  useLayoutStore.setState({ titlebarOrder: ["session:w1", "session:w2", "session:d1", "session:x1"], splitTabs: [], root: null });
  renderHook(() => usePaneDragController());
});

describe("stack drags", () => {
  it("moves every member when a stack pill is dropped after another tab", () => {
    act(() => useDragStore.getState().beginTabDrag("w1", 0, 0, "stack:web"));
    drop({ targetKey: "session:d1", placement: "after" });
    expect(useLayoutStore.getState().titlebarOrder).toEqual(["session:d1", "session:w1", "session:w2", "session:x1"]);
  });

  it("drops before a stack at its first member", () => {
    act(() => useDragStore.getState().beginTabDrag("x1", 0, 0, "session:x1"));
    drop({ targetKey: "stack:web", placement: "before" });
    expect(useLayoutStore.getState().titlebarOrder).toEqual(["session:x1", "session:w1", "session:w2", "session:d1"]);
  });

  it("does nothing when a session list row is dropped on the bar", () => {
    act(() => useDragStore.getState().beginTabDrag("w2", 0, 0, "session:w2", { fromStackList: true }));
    drop({ targetKey: "session:x1", placement: "after" });
    expect(useLayoutStore.getState().titlebarOrder).toEqual(["session:w1", "session:w2", "session:d1", "session:x1"]);
  });

  it("joins a detached pane onto its host's stack when grouping is on", () => {
    useSessionStore.setState({
      sessions: [s("w1", "web"), s("w2", "web"), s("d1", "db"), s("x1", "x"), s("w3", "web")],
      activeSessionId: "w1",
    });
    useLayoutStore.getState().createSplitTab("d1", "w3", "right");
    const leaf = findLeafBySession(useLayoutStore.getState().root, "w3");
    expect(leaf).not.toBeNull();
    act(() => useDragStore.getState().beginPaneDrag(leaf!.id, "w3", 0, 0));
    drop({ targetKey: "session:x1", placement: "after" });
    const order = useLayoutStore.getState().titlebarOrder;
    expect(order.indexOf("session:w3")).toBe(order.indexOf("session:w2") + 1);
  });

  it("honours the drop position when grouping is off", () => {
    useToggleSettingsStore.setState({ values: { "group-tabs-by-host": false } });
    useSessionStore.setState({
      sessions: [s("w1", "web"), s("w2", "web"), s("d1", "db"), s("x1", "x"), s("w3", "web")],
      activeSessionId: "w1",
    });
    useLayoutStore.getState().createSplitTab("d1", "w3", "right");
    const leaf = findLeafBySession(useLayoutStore.getState().root, "w3");
    expect(leaf).not.toBeNull();
    act(() => useDragStore.getState().beginPaneDrag(leaf!.id, "w3", 0, 0));
    drop({ targetKey: "session:x1", placement: "after" });
    expect(useLayoutStore.getState().titlebarOrder).toEqual(["session:w1", "session:w2", "session:d1", "session:x1", "session:w3"]);
  });
});
