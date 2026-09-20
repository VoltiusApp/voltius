import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSessionStore } from "@/stores/sessionStore";
import { connectedSince } from "./sessionUptime";

const session = (id: string, status: "connected" | "connecting" | "error") =>
  ({ id, connectionId: "c", connectionName: "c", status, type: "ssh" }) as never;

describe("connectedSince", () => {
  beforeEach(() => { vi.useFakeTimers(); useSessionStore.setState({ sessions: [], activeSessionId: null }); });

  it("records the moment a session becomes connected and keeps it while connected", () => {
    vi.setSystemTime(1_000);
    useSessionStore.setState({ sessions: [session("a", "connecting")] });
    expect(connectedSince("a")).toBeNull();
    vi.setSystemTime(5_000);
    useSessionStore.setState({ sessions: [session("a", "connected")] });
    vi.setSystemTime(9_000);
    useSessionStore.setState({ sessions: [session("a", "connected")] });
    expect(connectedSince("a")).toBe(5_000);
  });

  it("forgets it when the session leaves connected or disappears", () => {
    useSessionStore.setState({ sessions: [session("a", "connected")] });
    useSessionStore.setState({ sessions: [session("a", "error")] });
    expect(connectedSince("a")).toBeNull();
    useSessionStore.setState({ sessions: [session("b", "connected")] });
    useSessionStore.setState({ sessions: [] });
    expect(connectedSince("b")).toBeNull();
  });
});
