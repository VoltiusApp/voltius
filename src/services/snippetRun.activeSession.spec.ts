import { describe, it, expect, beforeEach, vi } from "vitest";
import type { TerminalSession } from "@/types";

let sessions: TerminalSession[] = [];
let activeSessionId: string | null = null;
vi.mock("@/stores/sessionStore", () => ({
  useSessionStore: { getState: () => ({ sessions, activeSessionId }) },
}));

import { getActiveRunnableSession } from "./snippetRun";

function mkSession(over: Partial<TerminalSession>): TerminalSession {
  return {
    id: "sess1", type: "ssh", status: "connected", connectionId: "c1",
    connectionName: "web01", ...over,
  } as TerminalSession;
}

describe("getActiveRunnableSession", () => {
  beforeEach(() => {
    sessions = [];
    activeSessionId = null;
  });

  it("returns the focused session, not the first connected one", () => {
    sessions = [
      mkSession({ id: "sess1" }),
      mkSession({ id: "sess2", connectionId: "c2", connectionName: "db01" }),
      mkSession({ id: "sess5", type: "local", connectionId: "", connectionName: "Local Shell" }),
    ];
    activeSessionId = "sess5";
    expect(getActiveRunnableSession()?.id).toBe("sess5");
  });

  it("returns null when the focused session is a multiplayer mirror", () => {
    sessions = [mkSession({ id: "sess1" }), mkSession({ id: "sess2", type: "multiplayer" })];
    activeSessionId = "sess2";
    expect(getActiveRunnableSession()).toBeNull();
  });

  it("returns null when the focused session is not connected", () => {
    sessions = [mkSession({ id: "sess1" }), mkSession({ id: "sess2", status: "connecting" })];
    activeSessionId = "sess2";
    expect(getActiveRunnableSession()).toBeNull();
  });

  it("returns null when nothing is focused", () => {
    sessions = [mkSession({ id: "sess1" })];
    expect(getActiveRunnableSession()).toBeNull();
  });
});
