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
import { sshConnect } from "@/services/ssh";
import { BackendError } from "@/services/backendErrors";
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
  test("a username-only host can request NetBird sign-in and finish in the same tab", async () => {
    h.resolveConnectionCredentials.mockResolvedValue({ username: "root" });
    const required = new BackendError("ssh-netbird-sso-required", "Sign in to NetBird");
    vi.mocked(sshConnect).mockRejectedValueOnce(required);
    await expect(useSessionStore.getState().connect("c1")).rejects.toBe(required);
    expect(current().errorCode).toBe(required.code);
    const sessionId = current().id;

    const profile = { issuer: "https://id.example", clientId: "public", scope: "openid",
      audience: "", tokenType: "id_token" as const, fingerprint: "SHA256:" + "A".repeat(43) };
    h.resolveConnectionCredentials.mockResolvedValue({ username: "root", password: "unused-vault-secret" });
    vi.mocked(sshConnect).mockImplementationOnce(async ({ netbird, password }) => {
      expect(password).toBeUndefined();
      expect(netbird?.profile).toEqual(profile);
      const challenge = { verificationUri: "https://id.example/device", userCode: "ABCD" };
      netbird!.onChallenge(challenge);
      expect(current().netbirdChallenge).toEqual(challenge);
      netbird!.onChallenge(null);
    });
    await useSessionStore.getState().reconnect(sessionId, { netbird: profile });
    expect(current()).toMatchObject({ id: sessionId, status: "connected", connectedUsername: "root" });
    expect(current().netbirdChallenge).toBeUndefined();
  });

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
