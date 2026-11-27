// @vitest-environment jsdom
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
  saveConnection: vi.fn(async (data: object) => ({ ...data, id: "saved" })),
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
      saveConnection: h.saveConnection,
      updateConnection: vi.fn(async () => {}),
    }),
  },
  connectionToFormData: vi.fn(() => ({})),
}));
vi.mock("@/services/vault", async (original) => ({
  ...(await original<typeof import("@/services/vault")>()),
  storeSecret: vi.fn(async () => {}),
}));
vi.mock("./layoutStore", () => ({
  useLayoutStore: { getState: () => ({ setSplitTabActive: vi.fn() }) },
}));
vi.mock("@/services/hostCommandRun", () => ({ runHostCommand: vi.fn(async () => {}) }));
vi.mock("@/services/auditReporter", () => ({ reportAuditClientEvent: vi.fn() }));
vi.mock("@/services/auditContextResolver", () => ({ auditContextForVaultId: vi.fn(() => ({})) }));

import { useSessionStore } from "./sessionStore";
import { sshConnect } from "@/services/ssh";
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

  // Without a code the overlay must match a translated message: en-only, silently.
  test("a connect blocked by an unreadable vault records the vault code", async () => {
    h.resolveConnectionCredentials.mockRejectedValue(new VaultUnreadableError());

    await expect(useSessionStore.getState().connect("c1")).rejects.toThrow(VaultUnreadableError);

    const failed = useSessionStore.getState().sessions[0];
    expect(failed.status).toBe("error");
    expect(failed.errorCode).toBe("vault-unreadable");
  });

  test("a username-only host can authenticate with the server's none method", async () => {
    h.resolveConnectionCredentials.mockResolvedValue({ username: "root" });
    await useSessionStore.getState().connect("c1");
    expect(sshConnect).toHaveBeenCalledWith(expect.objectContaining({
      username: "root", password: undefined, privateKey: undefined,
    }));
    expect(current().status).toBe("connected");
  });

  test("a quick-connect host is saved only once a retry authenticates", async () => {
    const quick = { ...connection, id: "q1", username: "" } as Connection;
    await expect(useSessionStore.getState().connectDirect(quick)).rejects.toThrow("No username provided");
    const id = current().id;

    vi.mocked(sshConnect).mockRejectedValueOnce(new Error("No authentication method provided"));
    await useSessionStore.getState().retryConnect(id, { username: "ops" }, true);
    expect(current().status).toBe("error");
    expect(h.saveConnection).not.toHaveBeenCalled();

    await useSessionStore.getState().retryConnect(id, { password: "pw" }, true);
    expect(sshConnect).toHaveBeenLastCalledWith(expect.objectContaining({ username: "ops", password: "pw", connectionId: "q1" }));
    expect(h.saveConnection).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ host: "h1", username: "ops" }));
    expect(current()).toMatchObject({ status: "connected", connectionId: "saved" });
  });

  test("a proxy with no host fails a quick-connect session instead of leaving it connecting", async () => {
    const quick = { ...connection, id: "q1", key_id: "k1", proxy: { mode: "socks5" } } as Connection;

    await expect(useSessionStore.getState().connectDirect(quick)).rejects.toThrow(/no host/);

    const failed = useSessionStore.getState().sessions[0];
    expect(failed.status).toBe("error");
    expect(failed.errorMessage).toMatch(/no host/);
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
