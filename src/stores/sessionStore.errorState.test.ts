import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Connection, TerminalSession } from "@/types";

const connection = {
  id: "c1",
  name: "srv",
  host: "h1",
  port: 22,
  username: "root",
  connection_type: "ssh",
} as unknown as Connection;

vi.mock("@/services/ssh", () => ({
  sshConnect: vi.fn(async () => {}),
  sshDisconnect: vi.fn(async () => true),
  sshDisconnectForReconnect: vi.fn(async () => {}),
  sshDetectDistro: vi.fn(async () => null),
  sshSendInput: vi.fn(async () => {}),
}));
const h = vi.hoisted(() => ({
  resolveConnectionCredentials: vi.fn(async () => ({ username: "root", password: "pw" }) as unknown),
}));

vi.mock("@/services/credentials", () => ({
  resolveConnectionCredentials: h.resolveConnectionCredentials,
  resolveJumpHosts: vi.fn(async () => []),
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: {
    getState: () => ({
      connections: [connection],
      teamConnections: {},
      setLastUsed: vi.fn(async () => {}),
    }),
  },
  connectionToFormData: vi.fn(),
}));
vi.mock("./layoutStore", () => ({
  useLayoutStore: { getState: () => ({ setSplitTabActive: vi.fn() }) },
}));
vi.mock("@/services/hostCommandRun", () => ({ runHostCommand: vi.fn(async () => {}) }));
vi.mock("@/services/auditReporter", () => ({ reportAuditClientEvent: vi.fn() }));
vi.mock("@/services/auditContextResolver", () => ({ auditContextForVaultId: vi.fn(() => ({})) }));

import { useSessionStore } from "./sessionStore";
import { VaultUnreadableError } from "@/services/vaultErrors";

const session = (over: Partial<TerminalSession> = {}) =>
  ({
    id: "s1",
    type: "ssh",
    connectionId: "c1",
    title: "srv",
    status: "connected",
    ...over,
  }) as unknown as TerminalSession;

function seed(over: Partial<TerminalSession> = {}) {
  useSessionStore.setState({ sessions: [session(over)], activeSessionId: "s1" });
}

const current = () => useSessionStore.getState().sessions[0];

beforeEach(() => {
  vi.clearAllMocks();
  h.resolveConnectionCredentials.mockResolvedValue({ username: "root", password: "pw" });
  useSessionStore.setState({ sessions: [], activeSessionId: null });
});

describe("session error state", () => {
  test("markError records the message and the error status", () => {
    seed();
    useSessionStore.getState().markError("s1", "boom");

    expect(current().status).toBe("error");
    expect(current().errorMessage).toBe("boom");
  });

  test("markConnecting clears a previous failure", () => {
    seed({ status: "error", errorMessage: "boom" });
    useSessionStore.getState().markConnecting("s1");

    expect(current().status).toBe("connecting");
    expect(current().errorMessage).toBeUndefined();
  });

  test("markConnecting is a no-op once already connecting with no error", () => {
    seed({ status: "connecting" });
    const before = current();
    useSessionStore.getState().markConnecting("s1");

    expect(current()).toBe(before);
  });

  // Without a code the overlay can only read the message, and the message is
  // translated — so it would match in English and prompt for auth in every other
  // language, which is how a vault failure came to look like a missing password.
  test("a connect blocked by an unreadable vault records the vault code", async () => {
    h.resolveConnectionCredentials.mockRejectedValue(new VaultUnreadableError());

    await expect(useSessionStore.getState().connect("c1")).rejects.toThrow(VaultUnreadableError);

    const failed = useSessionStore.getState().sessions[0];
    expect(failed.status).toBe("error");
    expect(failed.errorCode).toBe("vault-unreadable");
  });

  test("markConnecting clears a stale vault code along with the message", () => {
    seed({ status: "error", errorMessage: "boom", errorCode: "vault-unreadable" });
    useSessionStore.getState().markConnecting("s1");

    expect(current().errorCode).toBeUndefined();
  });

  test("markConnected clears a stale vault code", () => {
    seed({ status: "error", errorMessage: "boom", errorCode: "vault-unreadable" });
    useSessionStore.getState().markConnected("s1");

    expect(current().errorCode).toBeUndefined();
  });

  test("an ordinary failure records no code", () => {
    seed();
    useSessionStore.getState().markError("s1", "Connection refused");

    expect(current().errorCode).toBeUndefined();
  });

  test("markConnecting leaves other sessions untouched", () => {
    useSessionStore.setState({
      sessions: [session({ status: "error", errorMessage: "boom" }), session({ id: "s2", status: "error", errorMessage: "other" })],
      activeSessionId: "s1",
    });
    useSessionStore.getState().markConnecting("s1");

    const [first, second] = useSessionStore.getState().sessions;
    expect(first.errorMessage).toBeUndefined();
    expect(second.errorMessage).toBe("other");
  });
});
