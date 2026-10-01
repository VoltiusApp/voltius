import { test, expect, vi, beforeEach } from "vitest";
import type { Connection } from "@/types";
import { IdentityPickUnavailableError } from "@/services/credentialPlan";

const connection = { id: "c1", name: "db-01", host: "h1", port: 22, username: "root", connection_type: "ssh", vault_id: "t1" } as unknown as Connection;
const issue = { connectionId: "c1", connectionName: "db-01", via: "pick" as const, reason: "missing" as const, hasFallback: true, fallbackName: "ops-deploy" };

const h = vi.hoisted(() => ({
  resolve: vi.fn(),
  sshConnect: vi.fn(async () => {}),
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
  useConnectionStore: { getState: () => ({ connections: [connection], teamConnections: {}, setLastUsed: vi.fn(async () => {}) }) },
  connectionToFormData: vi.fn(),
}));
vi.mock("./layoutStore", () => ({ useLayoutStore: { getState: () => ({ setSplitTabActive: vi.fn() }) } }));
vi.mock("@/services/hostCommandRun", () => ({ runHostCommand: vi.fn(async () => {}) }));
vi.mock("@/services/auditReporter", () => ({ reportAuditClientEvent: vi.fn() }));
vi.mock("@/services/auditContextResolver", () => ({ auditContextForVaultId: vi.fn(() => ({})) }));

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
