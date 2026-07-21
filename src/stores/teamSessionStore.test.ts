import { test, expect, vi, beforeEach } from "vitest";

const mp = vi.hoisted(() => ({
  listActiveSessions: vi.fn(async () => []),
  getMySessionKey: vi.fn(async () => ({ sessionKey: new Uint8Array() })),
  openWebSocket: vi.fn(),
  endMultiplayerSession: vi.fn(async () => {}),
  createVaultSession: vi.fn(), createInviteLinkSession: vi.fn(), drainSshOutputBuffer: vi.fn(() => undefined),
}));
const svc = vi.hoisted(() => ({
  getServerUrlValue: vi.fn(async () => "https://s"),
  getJwtToken: vi.fn(async () => "jwt"),
  getMyUserId: vi.fn(async () => "u1"),
}));
vi.mock("@/services/multiplayerService", () => mp);
vi.mock("@/services/ssh", () => ({ sshSendInput: vi.fn(async () => {}) }));
vi.mock("@/services/teamService", () => svc);
vi.mock("@/services/account", () => ({ getCurrentUserEmail: vi.fn(async () => "me@x") }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { useTeamSessionStore } from "./teamSessionStore.ts";

const connStub = () => ({
  close: vi.fn(), requestControl: vi.fn(), grantControl: vi.fn(), revokeControl: vi.fn(),
});
const get = () => useTeamSessionStore.getState();

beforeEach(() => {
  Object.values(mp).forEach((f) => f.mockClear());
  useTeamSessionStore.setState({ activeSessions: [], connections: {} });
});

test("requestControl/grantControl/revokeControl delegate to the connection", () => {
  const c = connStub();
  useTeamSessionStore.setState({ connections: { L1: { multiplayerSessionId: "m1", role: "host", myUserId: "u1", participants: [], controlHolder: "", controlRequester: null, connection: c as never } } });
  get().requestControl("L1");
  get().grantControl("L1", "u2");
  get().revokeControl("L1");
  expect(c.requestControl).toHaveBeenCalledOnce();
  expect(c.grantControl).toHaveBeenCalledWith("u2");
  expect(c.revokeControl).toHaveBeenCalledOnce();
});

test("leaveSession closes the connection and removes it from state", () => {
  const c = connStub();
  useTeamSessionStore.setState({ connections: { L1: { multiplayerSessionId: "m1", role: "guest", myUserId: "u1", participants: [], controlHolder: "", controlRequester: null, connection: c as never } } });
  get().leaveSession("L1");
  expect(c.close).toHaveBeenCalledOnce();
  expect(get().connections.L1).toBeUndefined();
});

test("joinSession wires callbacks that drive the participant/control state machine", async () => {
  let cb: any;
  mp.openWebSocket.mockImplementation((...args: any[]) => { cb = args[5]; return connStub(); });

  const localId = await get().joinSession("m1", "Guest", () => {});
  expect(get().connections[localId]).toMatchObject({ role: "guest", multiplayerSessionId: "m1" });

  cb.onParticipantList([{ user_id: "u1" }, { user_id: "u2" }]);
  expect(get().connections[localId].participants.map((p: any) => p.user_id)).toEqual(["u1", "u2"]);

  cb.onParticipantJoined({ user_id: "u3" });
  expect(get().connections[localId].participants.map((p: any) => p.user_id)).toEqual(["u1", "u2", "u3"]);

  cb.onParticipantJoined({ user_id: "u3" }); // dedup by user_id
  expect(get().connections[localId].participants.filter((p: any) => p.user_id === "u3")).toHaveLength(1);

  cb.onParticipantLeft("u1");
  expect(get().connections[localId].participants.map((p: any) => p.user_id)).toEqual(["u2", "u3"]);

  cb.onControlUpdate("u2", "u3");
  expect(get().connections[localId]).toMatchObject({ controlHolder: "u2", controlRequester: "u3" });

  cb.onSessionEnded(); // guest → marked ended, not removed
  expect(get().connections[localId].ended).toBe(true);
});
