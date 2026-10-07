import { test, expect, vi, beforeEach } from "vitest";

const mp = vi.hoisted(() => ({
  listActiveSessions: vi.fn(async () => []),
  getMySessionKey: vi.fn(async () => ({ sessionKey: new Uint8Array() })),
  openWebSocket: vi.fn(),
  endMultiplayerSession: vi.fn(async () => {}),
  createVaultSession: vi.fn(), createInviteLinkSession: vi.fn(), drainSessionOutputBuffer: vi.fn(() => undefined),
  waitForWrappedSessionKey: vi.fn(), inviteUserToSession: vi.fn(async () => {}),
}));
const svc = vi.hoisted(() => ({
  getServerUrlValue: vi.fn(async () => "https://s"),
  getJwtToken: vi.fn(async () => "jwt"),
  getMyUserId: vi.fn(async () => "u1"),
}));
const io = vi.hoisted(() => ({
  sendSessionInput: vi.fn(async () => {}),
  getSessionTransportType: vi.fn(() => "ssh"),
  encoding: undefined as string | undefined,
}));
const stores = vi.hoisted(() => ({
  sessions: [] as { id: string; connectionId: string }[],
  teamConnections: {} as Record<string, { id: string }[]>,
}));
vi.mock("@/services/multiplayerService", () => mp);
vi.mock("@/services/sessionInput", () => ({ sendSessionInput: io.sendSessionInput }));
vi.mock("@/stores/sessionStore", () => ({
  getSessionTransportType: io.getSessionTransportType,
  encodeSessionText: (_id: string, text: string) => encodeTerminalInput(text, io.encoding),
  useSessionStore: { getState: () => ({ sessions: stores.sessions }) },
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: { getState: () => ({ teamConnections: stores.teamConnections }) },
}));
vi.mock("@/services/teamService", () => svc);
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { encodeTerminalInput } from "@/utils/terminalEncoding";
import { attachGuestOutput, useTeamSessionStore } from "./teamSessionStore.ts";

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
  io.encoding = undefined;
  stores.sessions = [];
  stores.teamConnections = {};
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

async function shareAsHost(localId: string): Promise<any> {
  let cb: any;
  mp.openWebSocket.mockImplementation((...args: any[]) => {
    cb = args.find((a) => a && typeof a === "object" && "onParticipantList" in a);
    return connStub();
  });
  mp.createVaultSession.mockResolvedValueOnce({ sessionId: "m1", sessionKey: new Uint8Array([1]), sessionKeyBytes: new Uint8Array(32) });
  await get().startSharing(localId, ["v1"], [], "conn", []);
  return cb;
}

// Regression guard: a host's callbacks used to write a guest's keystrokes with
// sshSendInput unconditionally, so control handed to a guest on a shared local
// shell or serial session went nowhere.
test.each([
  ["local", "local-1"],
  ["serial", "serial-1"],
  ["ssh", "ssh-1"],
] as const)("a guest's input reaches a %s host session's own transport", async (type, localId) => {
  io.getSessionTransportType.mockReturnValue(type);
  const cb = await shareAsHost(localId);

  cb.onControlUpdate("u2", null);
  cb.onInput(new Uint8Array([0x6c, 0x73]), "u2");

  expect(io.sendSessionInput).toHaveBeenCalledWith(localId, type, expect.anything());
  expect(Array.from((io.sendSessionInput.mock.calls[0] as unknown[])[2] as Uint8Array)).toEqual([0x6c, 0x73]);
});

test("a guest's UTF-8 input reaches a GBK host session as GBK", async () => {
  io.encoding = "gbk";
  const cb = await shareAsHost("gbk-1");

  cb.onControlUpdate("u2", null);
  cb.onInput(new TextEncoder().encode("中"), "u2");

  expect(Array.from((io.sendSessionInput.mock.calls[0] as unknown[])[2] as Uint8Array)).toEqual([0xd6, 0xd0]);
});

test("the host drops relayed input from anyone but the control holder", async () => {
  const cb = await shareAsHost("pty-1");
  const ls = new Uint8Array([0x6c, 0x73]);

  cb.onInput(ls, "u2");
  expect(io.sendSessionInput).not.toHaveBeenCalled();

  cb.onControlUpdate("u2", null);
  cb.onInput(ls, "u3");
  expect(io.sendSessionInput).not.toHaveBeenCalled();
  cb.onInput(ls, "u2");
  expect(io.sendSessionInput).toHaveBeenCalledOnce();

  cb.onControlUpdate("u1", null);
  cb.onInput(ls, "u2");
  expect(io.sendSessionInput).toHaveBeenCalledOnce();
});

// Regression guard: attachAsHost (the host-side path shared by startSharing,
// startSharingInviteLink and startSharingDirect) used to resolve
// getCurrentUserEmail() into a displayName and forward it into openWebSocket.
// That leak point is gone; this proves it stays gone by inspecting every
// argument openWebSocket actually receives, not just this call site's own
// (now email-free) signature.
test("startSharing passes the team connection id when the local session is on a team host", async () => {
  mp.openWebSocket.mockImplementation(() => connStub());
  mp.createVaultSession.mockResolvedValueOnce({ sessionId: "m1", sessionKey: new Uint8Array([1]), sessionKeyBytes: new Uint8Array(32) });
  stores.sessions = [{ id: "local1", connectionId: "c1" }];
  stores.teamConnections = { t1: [{ id: "c1" }] };

  await get().startSharing("local1", ["t1"], [], "conn", []);

  expect(mp.createVaultSession).toHaveBeenCalledWith(["t1"], [], "conn", [], "c1");
});

test("startSharing passes null when the local session's connection is not on any shared vault", async () => {
  mp.openWebSocket.mockImplementation(() => connStub());
  mp.createVaultSession.mockResolvedValueOnce({ sessionId: "m1", sessionKey: new Uint8Array([1]), sessionKeyBytes: new Uint8Array(32) });
  stores.sessions = [{ id: "local1", connectionId: "c1" }];
  stores.teamConnections = {};

  await get().startSharing("local1", ["t1"], [], "conn", []);

  expect(mp.createVaultSession).toHaveBeenCalledWith(["t1"], [], "conn", [], null);
});

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

// Regression guard: output that arrived before the guest view mounted was dropped.
test("a guest's output that arrives before its terminal attaches is replayed, in order", async () => {
  let cb: any;
  mp.openWebSocket.mockImplementation((...args: any[]) => {
    cb = args.find((a) => a && typeof a === "object" && "onParticipantList" in a);
    return connStub();
  });
  const localId = await get().joinSession("m1", () => {});
  const chunk = (b: number) => new Uint8Array([b]);

  cb.onOutput(chunk(1));
  cb.onOutput(chunk(2));
  const written: number[] = [];
  const detach = attachGuestOutput(localId, (d) => written.push(...d));
  expect(written).toEqual([1, 2]);

  cb.onOutput(chunk(3));
  expect(written).toEqual([1, 2, 3]);

  detach();
  cb.onOutput(chunk(4));
  const rewritten: number[] = [];
  attachGuestOutput(localId, (d) => rewritten.push(...d));
  expect(rewritten).toEqual([4]);
});

test("output held for a guest view that never attaches keeps only the newest 64 KB", async () => {
  let cb: any;
  mp.openWebSocket.mockImplementation((...args: any[]) => {
    cb = args.find((a) => a && typeof a === "object" && "onParticipantList" in a);
    return connStub();
  });
  const localId = await get().joinSession("m1", () => {});
  for (let i = 0; i < 100; i++) cb.onOutput(new Uint8Array(1024).fill(i));

  const write = vi.fn();
  attachGuestOutput(localId, write);
  const held = write.mock.calls[0][0] as Uint8Array;
  expect(held.length).toBe(64 * 1024);
  expect(held[held.length - 1]).toBe(99);
});

test("leaving a guest session drops the output held for it", async () => {
  let cb: any;
  mp.openWebSocket.mockImplementation((...args: any[]) => {
    cb = args.find((a) => a && typeof a === "object" && "onParticipantList" in a);
    return connStub();
  });
  const localId = await get().joinSession("m1", () => {});
  cb.onOutput(new Uint8Array([1]));
  get().leaveSession(localId);
  cb.onOutput(new Uint8Array([2]));

  const write = vi.fn();
  attachGuestOutput(localId, write);
  expect(write).not.toHaveBeenCalled();
});

function captureCallbacks(conn = connStub()): { cb: () => any; conn: ReturnType<typeof connStub> } {
  let cb: any;
  mp.openWebSocket.mockImplementation((...args: any[]) => {
    cb = args.find((a) => a && typeof a === "object" && "onParticipantList" in a);
    return conn;
  });
  return { cb: () => cb, conn };
}

test("a link host answers key_request by wrapping its retained key for that guest, once", async () => {
  const { cb } = captureCallbacks();
  const sessionKeyBytes = new Uint8Array(32).fill(9);
  mp.createInviteLinkSession.mockResolvedValueOnce({ sessionId: "m2", sessionKey: sessionKeyBytes, sessionKeyBytes, inviteToken: "tok" });
  await get().startSharingInviteLink("L2", "conn");

  cb().onKeyRequest("guest-1");

  await vi.waitFor(() => expect(mp.inviteUserToSession).toHaveBeenCalledOnce());
  expect(mp.inviteUserToSession).toHaveBeenCalledWith("m2", "guest-1", sessionKeyBytes);
});

test("a pending guest joins at once, waits for key_ready, then the socket gets the wrapped key", async () => {
  const { cb } = captureCallbacks();
  const sessionKey = new Uint8Array([4]);
  mp.getMySessionKey.mockResolvedValueOnce("pending" as never);
  mp.waitForWrappedSessionKey.mockImplementationOnce(async (_id: string, _tok: string, ready: Promise<void>) => {
    await ready;
    return { sessionKey, hostPublicKey: "HP" };
  });

  const localId = await get().joinSession("m1", () => {}, "tok");
  expect(get().connections[localId].keyWait).toBe("waiting");
  const keyArg = mp.openWebSocket.mock.calls[0][3];
  expect(keyArg).toBeInstanceOf(Promise);

  cb().onKeyReady();

  await expect(keyArg).resolves.toBe(sessionKey);
  await vi.waitFor(() => expect(get().connections[localId].keyWait).toBeUndefined());
});

test("a guest whose host never shares the key is told so and disconnected", async () => {
  const { conn } = captureCallbacks();
  mp.getMySessionKey.mockResolvedValueOnce("pending" as never);
  mp.waitForWrappedSessionKey.mockRejectedValueOnce(new Error("common.error.hostDidNotShareKey"));
  vi.spyOn(console, "error").mockImplementationOnce(() => {});

  const localId = await get().joinSession("m1", () => {}, "tok");

  await vi.waitFor(() => expect(get().connections[localId]).toMatchObject({ keyWait: "failed", ended: true }));
  expect(conn.close).toHaveBeenCalledOnce();
});


test("a guest never writes relayed input into a local session, even from the control holder", async () => {
  const { cb } = captureCallbacks();
  const localId = await get().joinSession("m1", () => {});
  cb().onControlUpdate("u2", null);

  cb().onInput(new Uint8Array([0x6c, 0x73]), "u2");

  expect(get().connections[localId].controlHolder).toBe("u2");
  expect(io.sendSessionInput).not.toHaveBeenCalled();
});
