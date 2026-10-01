import { describe, test, expect, vi, beforeEach } from "vitest";
import type { Connection } from "@/types";
import { IdentityPickUnavailableError } from "@/services/credentialPlan";

const connection = { id: "c1", name: "db-01", host: "h1", port: 22, username: "root", connection_type: "ssh", vault_id: "t1" } as unknown as Connection;
const sharedHost = { ...connection, id: "c2", identity_id: "shared" } as Connection;
const keyHost = { ...connection, id: "c3", key_id: "k9" } as Connection;
const orphanHost = { ...connection, id: "c4", identity_id: "gone" } as Connection;
const personalHost = { ...connection, id: "c5", vault_id: "personal" } as Connection;
const issue = { connectionId: "c1", connectionName: "db-01", via: "pick" as const, reason: "missing" as const, hasFallback: true, fallbackName: "ops-deploy" };

const h = vi.hoisted(() => ({
  resolve: vi.fn(),
  sshConnect: vi.fn(async () => {}),
  updateConnection: vi.fn(async () => {}),
  setHostPick: vi.fn(async () => {}),
  storeSecret: vi.fn(async () => {}),
  notifyError: vi.fn(),
}));

vi.mock("@/services/ssh", () => ({
  sshConnect: h.sshConnect,
  sshDisconnect: vi.fn(async () => true),
  sshDisconnectForReconnect: vi.fn(async () => {}),
  sshDetectDistro: vi.fn(async () => null),
  sshSendInput: vi.fn(async () => {}),
}));
vi.mock("@/services/credentials", () => ({
  resolveConnectionCredentials: h.resolve,
  resolveJumpHosts: vi.fn(async () => []),
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: { getState: () => ({ connections: [connection, sharedHost, keyHost, orphanHost, personalHost], teamConnections: {}, setLastUsed: vi.fn(async () => {}), updateConnection: h.updateConnection }) },
  connectionToFormData: (c: unknown) => ({ ...(c as object) }),
}));
vi.mock("@/stores/identityPickStore", () => ({
  useIdentityPickStore: { getState: () => ({ setHostPick: h.setHostPick, setVaultDefault: vi.fn(async () => {}) }) },
}));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: { getState: () => ({ identities: [{ id: "own", username: "alice" }], teamIdentities: { t1: [{ id: "shared", username: "deploy", key_id: "teamKey" }] } }) },
}));
vi.mock("@/services/vault", async (orig) => ({
  ...(await orig<typeof import("@/services/vault")>()),
  getSecret: async (k: string) => (k.startsWith("identity:") ? "pw" : null),
  storeSecret: h.storeSecret,
}));
vi.mock("./layoutStore", () => ({ useLayoutStore: { getState: () => ({ setSplitTabActive: vi.fn() }) } }));
vi.mock("@/services/hostCommandRun", () => ({ runHostCommand: vi.fn(async () => {}) }));
vi.mock("@/services/auditReporter", () => ({ reportAuditClientEvent: vi.fn() }));
vi.mock("@/services/connectionAuditMetadata", () => ({
  connectionAuditMetadata: vi.fn(async (creds: unknown) => (creds ? { identity_source: "own", key_fingerprint: "SHA256:x" } : undefined)),
}));
vi.mock("@/services/teamVaultSecrets", async (orig) => ({
  ...(await orig<typeof import("@/services/teamVaultSecrets")>()),
  resolveTeamIdForVaultId: (vaultId: string) => (vaultId === "t1" ? "t1" : null),
}));
vi.mock("@/utils/notifyError", () => ({ notifyError: h.notifyError }));
vi.mock("@/services/auditContextResolver", () => ({ auditContextForVaultId: vi.fn(() => ({})) }));

import { reportAuditClientEvent } from "@/services/auditReporter";
import { connectionAuditMetadata } from "@/services/connectionAuditMetadata";
import { useSessionStore } from "./sessionStore";

const unavailable = () => new IdentityPickUnavailableError(issue, "Your identity for db-01 isn't available");

beforeEach(() => {
  vi.clearAllMocks();
  useSessionStore.setState({ sessions: [], activeSessionId: null });
});

test("a connect with an unusable pick lands on the panel without dialling", async () => {
  h.resolve.mockRejectedValue(unavailable());
  await useSessionStore.getState().connect("c1", { keepFailedSession: true } as never).catch(() => {});

  const [session] = useSessionStore.getState().sessions;
  expect(session.status).toBe("error");
  expect(session.identityPick).toEqual(issue);
  expect(h.sshConnect).not.toHaveBeenCalled();
});

test("use the host credential this time skips the pick once and clears the panel", async () => {
  h.resolve.mockRejectedValueOnce(unavailable());
  await useSessionStore.getState().connect("c1", { keepFailedSession: true } as never).catch(() => {});
  const id = useSessionStore.getState().sessions[0].id;

  h.resolve.mockResolvedValueOnce({ username: "deploy", password: "pw" });
  await useSessionStore.getState().reconnect(id, { skipIdentityPick: true });

  expect(h.resolve).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c1" }), { skipPick: true });
  const session = useSessionStore.getState().sessions[0];
  expect(session.status).toBe("connected");
  expect(session.identityPick).toBeUndefined();
});

test("a plain reconnect still hits the pick and shows the panel", async () => {
  h.resolve.mockRejectedValue(unavailable());
  await useSessionStore.getState().connect("c1", { keepFailedSession: true } as never).catch(() => {});
  const id = useSessionStore.getState().sessions[0].id;

  await useSessionStore.getState().reconnect(id);

  expect(useSessionStore.getState().sessions[0].identityPick).toEqual(issue);
  expect(h.sshConnect).not.toHaveBeenCalled();
});

test("the silent reconnect attempt reports the issue for the backoff loop", async () => {
  h.resolve.mockResolvedValueOnce({ username: "root", password: "pw" });
  await useSessionStore.getState().connect("c1");
  const id = useSessionStore.getState().sessions[0].id;
  useSessionStore.setState((s) => ({ sessions: s.sessions.map((x) => ({ ...x, type: "ssh" as const })) }));

  h.resolve.mockRejectedValueOnce(unavailable());
  const result = await useSessionStore.getState().reconnectAttempt(id);

  expect(result).toMatchObject({ ok: false, identityPick: issue });
});

test("connection.started carries the identity metadata of the credentials used", async () => {
  h.resolve.mockResolvedValue({ username: "alice", privateKey: "P", identityId: "own", keyId: "k1" });
  await useSessionStore.getState().connect("c1");

  await vi.waitFor(() =>
    expect(reportAuditClientEvent).toHaveBeenCalledWith(
      expect.anything(),
      "connection.started",
      expect.objectContaining({ metadata: { identity_source: "own", key_fingerprint: "SHA256:x" } }),
    ),
  );
  expect(connectionAuditMetadata).toHaveBeenCalledWith(
    expect.objectContaining({ identityId: "own", keyId: "k1" }),
    expect.any(Function),
  );
});

test("a reconnect reports the credentials it used and the stamp taken before fingerprinting", async () => {
  h.resolve.mockResolvedValue({ username: "root", password: "pw" });
  await useSessionStore.getState().connect("c1");
  const id = useSessionStore.getState().sessions[0].id;
  vi.clearAllMocks();

  let release!: (v: Record<string, unknown>) => void;
  vi.mocked(connectionAuditMetadata).mockImplementationOnce(() => new Promise((r) => { release = r; }));
  h.resolve.mockResolvedValue({ username: "alice", privateKey: "P", identityId: "own", keyId: "k1" });
  await useSessionStore.getState().reconnect(id);
  const before = new Date().toISOString();
  await new Promise((r) => setTimeout(r, 5));
  release({ identity_source: "own" });

  await vi.waitFor(() => expect(reportAuditClientEvent).toHaveBeenCalled());
  expect(connectionAuditMetadata).toHaveBeenLastCalledWith(
    expect.objectContaining({ identityId: "own", keyId: "k1" }),
    expect.any(Function),
  );
  const target = vi.mocked(reportAuditClientEvent).mock.calls[0][2] as { occurred_at: string };
  expect(target.occurred_at <= before).toBe(true);
});

test("Connect & Save with Everyone writes the host exactly as before", async () => {
  h.resolve.mockResolvedValue({ username: "root" });
  await useSessionStore.getState().connect("c1").catch(() => {});
  const id = useSessionStore.getState().sessions[0].id;
  useSessionStore.setState((s) => ({ sessions: s.sessions.map((x) => ({ ...x, type: "ssh" as const })) }));

  await useSessionStore.getState().retryConnect(id, { identityId: "shared" }, true);

  expect(h.updateConnection).toHaveBeenCalledWith("c1", expect.objectContaining({ identity_id: "shared" }));
  expect(h.setHostPick).not.toHaveBeenCalled();
});

test("Connect & Save with a pick never touches the host", async () => {
  h.resolve.mockResolvedValue({ username: "root" });
  await useSessionStore.getState().connect("c1").catch(() => {});
  const id = useSessionStore.getState().sessions[0].id;
  useSessionStore.setState((s) => ({ sessions: s.sessions.map((x) => ({ ...x, type: "ssh" as const })) }));

  await useSessionStore.getState().retryConnect(id, { identityId: "own", saveAs: "pick" }, true);

  expect(h.setHostPick).toHaveBeenCalledWith("c1", "own");
  expect(h.updateConnection).not.toHaveBeenCalled();
});

const sshSession = async () => {
  h.resolve.mockResolvedValue({ username: "root" });
  await useSessionStore.getState().connect("c1").catch(() => {});
  const id = useSessionStore.getState().sessions[0].id;
  useSessionStore.setState((s) => ({ sessions: s.sessions.map((x) => ({ ...x, type: "ssh" as const })) }));
  h.updateConnection.mockClear();
  h.setHostPick.mockClear();
  return id;
};

test("a save target from a failed attempt is not inherited by the next Connect & Save", async () => {
  const id = await sshSession();
  h.sshConnect.mockRejectedValueOnce(new Error("auth failed"));
  await useSessionStore.getState().retryConnect(id, { identityId: "own", saveAs: "pick" }, false);

  await useSessionStore.getState().retryConnect(id, { identityId: "shared" }, true);

  expect(h.updateConnection).toHaveBeenCalledWith("c1", expect.objectContaining({ identity_id: "shared" }));
  expect(h.setHostPick).not.toHaveBeenCalled();
});

test("a typed password after a stale save target still saves on the host", async () => {
  const id = await sshSession();
  h.sshConnect.mockRejectedValueOnce(new Error("auth failed"));
  await useSessionStore.getState().retryConnect(id, { identityId: "own", saveAs: "pick" }, false);

  await useSessionStore.getState().retryConnect(id, { password: "pw" }, true);

  expect(h.updateConnection).toHaveBeenCalled();
  expect(h.setHostPick).not.toHaveBeenCalled();
});

const sessionOn = async (connectionId: string) => {
  h.resolve.mockResolvedValueOnce({ username: "root", password: "pw" });
  await useSessionStore.getState().connect(connectionId);
  const { sessions } = useSessionStore.getState();
  return sessions[sessions.length - 1].id;
};

describe("a saved passphrase goes to the key that was used", () => {
  test("a pick's personal key gets it, never the team key or the host", async () => {
    const id = await sessionOn("c2");
    h.resolve.mockResolvedValueOnce({ username: "alice", privateKey: "P", identityId: "own", keyId: "ownKey" });
    await useSessionStore.getState().reconnectWithPassphrase(id, "pp", true);

    expect(h.storeSecret.mock.calls).toEqual([["key:ownKey:passphrase", "pp"]]);
  });

  test("a keyless pick on a host with a shared key saves nothing", async () => {
    const id = await sessionOn("c2");
    h.resolve.mockResolvedValueOnce({ username: "alice", password: "pw", identityId: "own" });
    await useSessionStore.getState().reconnectWithPassphrase(id, "pp", true);

    expect(h.storeSecret).not.toHaveBeenCalled();
  });

  test.each([
    ["the host key", "c3", { keyId: "k9" }, ["key:k9:passphrase", "pp"]],
    ["the host identity's key", "c2", { identityId: "shared", keyId: "teamKey" }, ["key:teamKey:passphrase", "pp"]],
    ["an inline host key", "c1", {}, ["passphrase:c1", "pp"]],
    ["nowhere when the host identity is not loaded", "c4", {}, undefined],
  ])("without a pick it saves to %s, as before", async (_label, connId, creds, expected) => {
    const id = await sessionOn(connId);
    h.resolve.mockResolvedValueOnce({ username: "root", privateKey: "P", ...creds });
    await useSessionStore.getState().reconnectWithPassphrase(id, "pp", true);

    expect(h.storeSecret.mock.calls[0]).toEqual(expected);
  });
});

describe("use the host credential this time, through a passphrase prompt", () => {
  const passphraseFailure = () => h.sshConnect.mockRejectedValueOnce(new Error("Key is encrypted: passphrase required"));

  test("the passphrase retry keeps skipping the pick, then the next reconnect uses it again", async () => {
    const id = await sessionOn("c1");
    h.resolve.mockResolvedValue({ username: "deploy", privateKey: "P", keyId: "teamKey" });
    passphraseFailure();
    await useSessionStore.getState().reconnect(id, { skipIdentityPick: true });

    await useSessionStore.getState().reconnectWithPassphrase(id, "pp", false);
    expect(h.resolve).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c1" }), { skipPick: true });
    expect(useSessionStore.getState().sessions[0].status).toBe("connected");

    await useSessionStore.getState().reconnectWithPassphrase(id, "pp", false);
    expect(h.resolve).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c1" }), { skipPick: false });
  });

  test.each([
    ["an overlay retry", (id: string) => useSessionStore.getState().retryConnect(id, { password: "pw" }, false)],
    ["a backoff success", (id: string) => useSessionStore.getState().reconnectAttempt(id)],
  ])("%s after a failed host-this-time attempt drops the one-shot skip", async (_label, recover) => {
    const id = await sessionOn("c1");
    h.resolve.mockResolvedValue({ username: "deploy", privateKey: "P", keyId: "teamKey" });
    h.sshConnect.mockRejectedValueOnce(new Error("Connection refused"));
    await useSessionStore.getState().reconnect(id, { skipIdentityPick: true });

    await recover(id);
    await useSessionStore.getState().reconnectWithPassphrase(id, "pp", false);
    expect(h.resolve).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c1" }), { skipPick: false });
  });

  test("a plain reconnect in between drops the one-shot skip", async () => {
    const id = await sessionOn("c1");
    h.resolve.mockResolvedValue({ username: "deploy", privateKey: "P", keyId: "teamKey" });
    passphraseFailure();
    await useSessionStore.getState().reconnect(id, { skipIdentityPick: true });
    passphraseFailure();
    await useSessionStore.getState().reconnect(id);

    await useSessionStore.getState().reconnectWithPassphrase(id, "pp", false);
    expect(h.resolve).toHaveBeenLastCalledWith(expect.objectContaining({ id: "c1" }), { skipPick: false });
  });
});

test("a pick that fails to save is reported, and the connection still goes ahead", async () => {
  const id = await sshSession();
  const failure = new Error("Couldn't save your identity choice");
  h.setHostPick.mockRejectedValueOnce(failure);

  await useSessionStore.getState().retryConnect(id, { identityId: "own", saveAs: "pick" }, true);

  expect(h.notifyError).toHaveBeenCalledWith(failure);
  expect(useSessionStore.getState().sessions[0].status).toBe("connected");
});

test("a personal host reports its connection exactly as before, with no identity metadata", async () => {
  h.resolve.mockResolvedValue({ username: "alice", privateKey: "P", identityId: "own", keyId: "k1" });
  await useSessionStore.getState().connect("c5");

  await vi.waitFor(() => expect(reportAuditClientEvent).toHaveBeenCalled());
  const target = vi.mocked(reportAuditClientEvent).mock.calls[0][2] as Record<string, unknown>;
  expect(target).not.toHaveProperty("metadata");
  expect(connectionAuditMetadata).toHaveBeenCalledWith(undefined, expect.any(Function));
});

describe("a session records the username it authenticated as", () => {
  const connectedAs = () => useSessionStore.getState().sessions[0].connectedUsername;

  test("on connect", async () => {
    h.resolve.mockResolvedValue({ username: "alice", password: "pw", identityId: "own" });
    await useSessionStore.getState().connect("c1");
    expect(connectedAs()).toBe("alice");
  });

  test("on reconnect, overlay retry and a backoff attempt", async () => {
    const id = await sessionOn("c1");
    expect(connectedAs()).toBe("root");

    h.resolve.mockResolvedValueOnce({ username: "alice", password: "pw", identityId: "own" });
    await useSessionStore.getState().reconnect(id);
    expect(connectedAs()).toBe("alice");

    h.resolve.mockResolvedValueOnce({ username: "root", password: "pw" });
    await useSessionStore.getState().retryConnect(id, { identityId: "shared" }, false);
    expect(connectedAs()).toBe("deploy");

    h.resolve.mockResolvedValueOnce({ username: "alice", password: "pw", identityId: "own" });
    await useSessionStore.getState().reconnectAttempt(id);
    expect(connectedAs()).toBe("alice");
  });
});

describe("use the host credential this time, then type a secret", () => {
  const resolveBy = (_c: unknown, opts?: { skipPick?: boolean }) =>
    Promise.resolve(opts?.skipPick ? { username: "root" } : { username: "alice", identityId: "own", password: "pw" });

  test("the typed password goes out with the host's username, not the pick's", async () => {
    const id = await sessionOn("c1");
    h.resolve.mockImplementation(resolveBy);
    h.sshConnect.mockRejectedValueOnce(new Error("auth failed"));
    await useSessionStore.getState().reconnect(id, { skipIdentityPick: true });

    await useSessionStore.getState().retryConnect(id, { password: "hostpw" }, false);

    expect(h.sshConnect).toHaveBeenLastCalledWith(expect.objectContaining({ username: "root", password: "hostpw" }));
  });

  test("a typed username still wins", async () => {
    const id = await sessionOn("c1");
    h.resolve.mockImplementation(resolveBy);

    await useSessionStore.getState().retryConnect(id, { username: "ops", password: "pw" }, false);

    expect(h.sshConnect).toHaveBeenLastCalledWith(expect.objectContaining({ username: "ops", password: "pw" }));
  });

  test("a username-only retry keeps the pick's credentials", async () => {
    const id = await sessionOn("c1");
    h.resolve.mockImplementation(resolveBy);

    await useSessionStore.getState().retryConnect(id, { username: "ops" }, false);

    expect(h.sshConnect).toHaveBeenLastCalledWith(expect.objectContaining({ username: "ops", password: "pw" }));
  });

  test("the session records the one-shot skip until the next action", async () => {
    const id = await sessionOn("c1");
    h.resolve.mockImplementation(resolveBy);
    h.sshConnect.mockRejectedValueOnce(new Error("Connection refused"));
    await useSessionStore.getState().reconnect(id, { skipIdentityPick: true });
    expect(useSessionStore.getState().sessions[0].skipIdentityPick).toBe(true);

    await useSessionStore.getState().reconnect(id);
    expect(useSessionStore.getState().sessions[0].skipIdentityPick).toBeUndefined();
  });
});
