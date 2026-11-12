import { afterEach, describe, expect, test } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";
import type { TerminalSession } from "@/types";
import { useMobileSessions } from "./useMobileSessions";

const s = (id: string, type: TerminalSession["type"] = "ssh"): TerminalSession => ({ id, connectionId: "c", connectionName: id, status: "connected", type });

describe("useMobileSessions", () => {
  afterEach(cleanup);

  test("drops multiplayer views and puts pinned sessions first, live", () => {
    useSessionStore.setState({ sessions: [s("a"), s("m", "multiplayer"), s("b")], activeSessionId: "a" });
    useLayoutStore.setState({ splitTabs: [], pinnedKeys: [] });
    const { result } = renderHook(() => useMobileSessions());
    expect(result.current.map((x) => x.id)).toEqual(["a", "b"]);
    act(() => useLayoutStore.getState().setPinned("session:b", true));
    expect(result.current.map((x) => x.id)).toEqual(["b", "a"]);
  });
});
