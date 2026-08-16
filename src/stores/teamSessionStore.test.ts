import { test, expect, vi, beforeEach } from "vitest";

const mp = vi.hoisted(() => ({
  listActiveSessions: vi.fn(async () => []),
  getMySessionKey: vi.fn(async () => ({ sessionKey: new Uint8Array() })),
  openWebSocket: vi.fn(),
  endMultiplayerSession: vi.fn(async () => {}),
  createVaultSession: vi.fn(), createInviteLinkSession: vi.fn(), drainSessionOutputBuffer: vi.fn(() => undefined),
}));
const svc = vi.hoisted(() => ({
  getServerUrlValue: vi.fn(async () => "https://s"),
  getJwtToken: vi.fn(async () => "jwt"),
  getMyUserId: vi.fn(async () => "u1"),
}));
const io = vi.hoisted(() => ({
  sendSessionInput: vi.fn(async () => {}),
  getSessionTransportType: vi.fn(() => "ssh"),
}));
vi.mock("@/services/multiplayerService", () => mp);
vi.mock("@/services/sessionInput", () => ({ sendSessionInput: io.sendSessionInput }));
vi.mock("@/stores/sessionStore", () => ({ getSessionTransportType: io.getSessionTransportType }));
vi.mock("@/services/teamService", () => svc);
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { useTeamSessionStore } from "./teamSessionStore.ts";

const connStub = () => ({
  close: vi.fn(), requestControl: vi.fn(), grantControl: vi.fn(), revokeControl: vi.fn(),
});
const get = () => useTeamSessionStore.getState();

/**
 * Guards against the identity-string leak (display_name/email) reaching
 * openWebSocket via any argument, at any position. Finds the callbacks
 * object by its onParticipantList shape rather than a fixed index, then
 * asserts every string-typed argument is exactly the expected non-identity
 * set — an unexpected extra string (an email, a handle passed where it
 * shouldn't be) fails the match immediately, regardless of position.
 */
function assertOpenWebSocketArgsCarryNoIdentity(args: unknown[], expectedStrings: string[]) {
  const callbacks = args.find((a) => a && typeof a === "object" && "onParticipantList" in a);
  expect(callbacks).toBeTruthy();
  const strings = args.filter((a): a is string => typeof a === "string");
  expect(strings).toEqual(expectedStrings);
}

beforeEach(() => {
  Object.values(mp).forEach((f) => f.mockClear());
  io.sendSessionInput.mockClear();
  io.getSessionTransportType.mockReset().mockReturnValue("ssh");
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
  // Found by shape, not position — a positional index breaks silently if
  // openWebSocket's parameter order ever changes again.
  mp.openWebSocket.mockImplementation((...args: any[]) => {
    cb = args.find((a) => a && typeof a === "object" && "onParticipantList" in a);
    return connStub();
  });

  const localId = await get().joinSession("m1", () => {});
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

// Regression guard: a host's callbacks used to write a guest's keystrokes with
// sshSendInput unconditionally, so control handed to a guest on a shared local
// shell or serial session went nowhere.
test.each([
  ["local", "local-1"],
  ["serial", "serial-1"],
  ["ssh", "ssh-1"],
] as const)("a guest's input reaches a %s host session's own transport", async (type, localId) => {
  io.getSessionTransportType.mockReturnValue(type);
  let cb: any;
  mp.openWebSocket.mockImplementation((...args: any[]) => {
    cb = args.find((a) => a && typeof a === "object" && "onParticipantList" in a);
    return connStub();
  });
  mp.createVaultSession.mockResolvedValueOnce({ sessionId: "m1", sessionKey: new Uint8Array([1]), sessionKeyBytes: new Uint8Array(32) });

  await get().startSharing(localId, ["v1"], [], "conn", []);

  const data = new Uint8Array([0x6c, 0x73]);
  cb.onInput(data);

  expect(io.sendSessionInput).toHaveBeenCalledWith(localId, type, data);
});

// Regression guard: attachAsHost (the host-side path shared by startSharing,
// startSharingInviteLink and startSharingDirect) used to resolve
// getCurrentUserEmail() into a displayName and forward it into openWebSocket.
// That leak point is gone; this proves it stays gone by inspecting every
// argument openWebSocket actually receives, not just this call site's own
// (now email-free) signature.
test("startSharing's attachAsHost calls openWebSocket with no identity string among its arguments", async () => {
  mp.openWebSocket.mockImplementation(() => connStub());
  const sessionKey = new Uint8Array([7]);
  mp.createVaultSession.mockResolvedValueOnce({ sessionId: "m9", sessionKey, sessionKeyBytes: new Uint8Array(32) });

  await get().startSharing("local-1", ["v1"], [], "conn-name", [], "teams");

  expect(mp.openWebSocket).toHaveBeenCalledTimes(1);
  const args = mp.openWebSocket.mock.calls[0];
  expect(args).toContain(sessionKey);
  assertOpenWebSocketArgsCarryNoIdentity(args, ["https://s", "m9", "jwt"]);
});

// Same regression guard for the guest path: joinSession forwards whatever
// teamSessionJoin.ts passes it straight into openWebSocket.
test("joinSession calls openWebSocket with no identity string among its arguments", async () => {
  mp.openWebSocket.mockImplementation(() => connStub());
  const sessionKey = new Uint8Array([3]);
  mp.getMySessionKey.mockResolvedValueOnce({ sessionKey });

  await get().joinSession("m1", () => {});

  expect(mp.openWebSocket).toHaveBeenCalledTimes(1);
  const args = mp.openWebSocket.mock.calls[0];
  expect(args).toContain(sessionKey);
  assertOpenWebSocketArgsCarryNoIdentity(args, ["https://s", "m1", "jwt"]);
});
