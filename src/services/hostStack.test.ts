import { describe, it, expect, beforeEach, vi } from "vitest";
import { useLayoutStore } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { openInSplit, pinHostList } from "./hostStack";

const s = (id: string) => ({ id, connectionId: "web", connectionName: "web", status: "connected", type: "ssh" }) as never;

beforeEach(() => {
  useSessionStore.setState({ sessions: [s("w1"), s("w2"), s("w3")], activeSessionId: "w1" });
  useLayoutStore.setState({ splitTabs: [], root: null, titlebarOrder: [] });
  useUIStore.setState({ hostPanelPinned: false });
});

describe("openInSplit", () => {
  it("splits the row with the session the stack shows", () => {
    const spy = vi.spyOn(useLayoutStore.getState(), "createSplitTab");
    openInSplit("w3", [s("w1"), s("w2"), s("w3")], "w1");
    expect(spy).toHaveBeenCalledWith("w1", "w3", "right");
    expect(useSessionStore.getState().activeSessionId).toBe("w3");
  });

  it("uses the next member when the row is the shown session", () => {
    const spy = vi.spyOn(useLayoutStore.getState(), "createSplitTab");
    openInSplit("w1", [s("w1"), s("w2")], "w1");
    expect(spy).toHaveBeenCalledWith("w2", "w1", "right");
  });
});

describe("pinHostList", () => {
  it("focuses the given session and pins the panel", () => {
    pinHostList("w3");
    expect(useSessionStore.getState().activeSessionId).toBe("w3");
    expect(useUIStore.getState().hostPanelPinned).toBe(true);
  });
});
