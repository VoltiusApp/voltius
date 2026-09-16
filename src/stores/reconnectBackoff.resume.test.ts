import { test, expect, vi, beforeEach, afterEach } from "vitest";
import type { TerminalSession } from "@/types";

const h = vi.hoisted(() => ({
  sessions: [] as TerminalSession[],
  networkChanged: undefined as undefined | (() => void),
  reconnectAttempt: vi.fn(async (_id: string, _options?: { restore?: boolean }) => ({ ok: true })),
}));

vi.mock("./sessionStore", () => ({
  connectionForSession: () => undefined,
  useSessionStore: {
    getState: () => ({
      sessions: h.sessions,
      reconnectAttempt: h.reconnectAttempt,
      markConnecting: (id: string) => patch(id, { status: "connecting", errorMessage: undefined }),
      markConnected: (id: string) => patch(id, { status: "connected" }),
      markError: (id: string, message: string) => patch(id, { status: "error", errorMessage: message }),
      setReconnectWait: vi.fn(),
    }),
  },
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, handler: () => void) => {
    h.networkChanged = handler;
    return () => {};
  }),
}));
vi.mock("./serialAutoReconnect", () => ({ serialAutoReconnectEnabled: () => true }));

function patch(id: string, fields: Partial<TerminalSession>) {
  h.sessions = h.sessions.map((s) => (s.id === id ? { ...s, ...fields } : s));
}

const restoredTab = (fields: Partial<TerminalSession> = {}): TerminalSession => ({
  id: "s1",
  connectionId: "c1",
  connectionName: "host",
  type: "ssh",
  persist: true,
  everConnected: true,
  status: "error",
  errorMessage: "Network is unreachable (os error 10051)",
  ...fields,
});

beforeEach(() => {
  vi.useFakeTimers();
  h.reconnectAttempt.mockReset();
  h.reconnectAttempt.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
});

test("a restored tab that failed offline keeps retrying, replaying its history once back", async () => {
  const { resumeIfStranded } = await import("./reconnectBackoff");
  h.sessions = [restoredTab()];

  resumeIfStranded("s1", { restore: true });
  expect(h.sessions[0].status).toBe("connecting");

  await vi.advanceTimersByTimeAsync(2000);
  expect(h.reconnectAttempt).toHaveBeenCalledWith("s1", { restore: true });
  expect(h.sessions[0].status).toBe("connected");
});

test("a tab waiting on the user is left on its prompt", async () => {
  const { resumeIfStranded } = await import("./reconnectBackoff");
  h.sessions = [restoredTab({ errorMessage: "The key is encrypted" })];

  resumeIfStranded("s1", { restore: true });
  await vi.advanceTimersByTimeAsync(2000);

  expect(h.sessions[0].status).toBe("error");
  expect(h.reconnectAttempt).not.toHaveBeenCalled();
});

test("the OS reporting a new address sends a tab whose first connect failed through a short catch-up", async () => {
  const { startNetworkWatch } = await import("./reconnectBackoff");
  startNetworkWatch();
  await vi.advanceTimersByTimeAsync(0);
  h.sessions = [restoredTab({ everConnected: false, persist: false })];
  h.reconnectAttempt.mockResolvedValue({ ok: false, errorMessage: "No such host is known" } as never);

  h.networkChanged?.();
  expect(h.sessions[0].status).toBe("connecting");
  await vi.advanceTimersByTimeAsync(10_000);

  expect(h.reconnectAttempt).toHaveBeenCalledTimes(3);
  expect(h.reconnectAttempt).toHaveBeenCalledWith("s1", { restore: false });
  expect(h.sessions[0]).toMatchObject({ status: "error", errorMessage: "No such host is known" });
  await vi.advanceTimersByTimeAsync(60_000);
  expect(h.reconnectAttempt).toHaveBeenCalledTimes(3);
});
