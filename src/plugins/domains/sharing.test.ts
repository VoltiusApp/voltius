import { expect, test, vi } from "vitest";
import type { MultiplayerConnection } from "@/services/multiplayerService";
import { listSharedSessions, shareSession, unshareSession, handoffControl, type SharingPorts } from "./sharing";

const hostState = (over: Record<string, unknown> = {}) => ({
  multiplayerSessionId: "m1", role: "host" as const, myUserId: "u0",
  participants: [{ user_id: "u2", display_name: "Two" }],
  controlHolder: "u0", controlRequester: null,
  connection: {} as MultiplayerConnection, ...over,
});

function ports(over: Partial<SharingPorts> = {}): SharingPorts {
  return {
    activeSessions: () => [{
      id: "m1", connection_name: "web-1", host_user_id: "u0", host_public_key: "",
      visibility: "team", created_at: "", participant_count: 1,
      participants: [{ user_id: "u2", display_name: "Two" }],
    }],
    fetchActiveSessions: vi.fn(async () => {}),
    state: (id: string) => (id === "s1" ? hostState() : undefined),
    localSessions: () => ["s1"],
    startSharing: vi.fn(async () => "m1"),
    stopSharing: vi.fn(async () => {}),
    grantControl: vi.fn(),
    broadcastActiveForSession: () => false,
    connectionName: () => "web-1",
    teamMembers: async () => [],
    ownerTier: () => "teams",
    myUserId: () => "u0",
    ...over,
  } as SharingPorts;
}

test("shareSession refuses while the session's tab is broadcasting", async () => {
  const startSharing = vi.fn(async () => "m1");
  const p = ports({ state: () => undefined, broadcastActiveForSession: () => true, startSharing });
  expect(await shareSession(p, { sessionId: "s1", vaultIds: ["t1"] })).toEqual({
    ok: false,
    error: "that tab has broadcast typing enabled; your own keystrokes would reach every participant — turn broadcast off before sharing",
  });
  expect(startSharing).not.toHaveBeenCalled();
});

test("shareSession passes the vault members and owner tier through to the store", async () => {
  const startSharing = vi.fn(async () => "m9");
  const members = [{ team_id: "t1", user_id: "u2", invited_by_display_name: null, joined_at: "", display_name: "Two", public_key: "pk2", role_ids: [] }];
  const p = ports({ state: () => undefined, startSharing, teamMembers: async () => members, ownerTier: () => "business" });
  expect(await shareSession(p, { sessionId: "s1", vaultIds: ["t1"], allowedRoles: ["manager"] }))
    .toEqual({ ok: true, result: { multiplayerSessionId: "m9" } });
  expect(startSharing).toHaveBeenCalledWith("s1", ["t1"], ["manager"], "web-1", members, "business");
});

test("shareSession refuses a session that is already shared", async () => {
  expect(await shareSession(ports(), { sessionId: "s1", vaultIds: ["t1"] }))
    .toEqual({ ok: false, error: "that session is already shared" });
});

test("shareSession refuses an empty vault list", async () => {
  const p = ports({ state: () => undefined });
  expect(await shareSession(p, { sessionId: "s1", vaultIds: [] }))
    .toEqual({ ok: false, error: "name at least one team vault to share with" });
});

test("unshareSession refuses a session that is not shared", async () => {
  const p = ports({ state: () => undefined });
  expect(await unshareSession(p, "s1")).toEqual({ ok: false, error: "that session is not shared" });
});

test("unshareSession refuses when the caller is a guest, not the host", async () => {
  const p = ports({ state: () => hostState({ role: "guest" }) });
  expect(await unshareSession(p, "s1")).toEqual({ ok: false, error: "only the host can stop sharing that session" });
});

test("handoffControl refuses when nobody has requested control", async () => {
  const grantControl = vi.fn();
  expect(await handoffControl(ports({ grantControl }), "s1", "u2")).toEqual({
    ok: false,
    error: "u2 has not requested control; control is only handed to a participant who asked for it (nobody is currently asking)",
  });
  expect(grantControl).not.toHaveBeenCalled();
});

test("handoffControl refuses when someone else is the pending requester, and names them", async () => {
  const p = ports({ state: () => hostState({ controlRequester: "u5" }) });
  expect(await handoffControl(p, "s1", "u2")).toEqual({
    ok: false,
    error: "u2 has not requested control; control is only handed to a participant who asked for it (u5 is currently asking)",
  });
});

test("handoffControl grants to the pending requester", async () => {
  const grantControl = vi.fn();
  const p = ports({ state: () => hostState({ controlRequester: "u2" }), grantControl });
  expect(await handoffControl(p, "s1", "u2")).toEqual({ ok: true, result: null });
  expect(grantControl).toHaveBeenCalledWith("s1", "u2");
});

test("handoffControl refuses when the caller is not the host", async () => {
  const p = ports({ state: () => hostState({ role: "guest", controlRequester: "u2" }) });
  expect(await handoffControl(p, "s1", "u2")).toEqual({ ok: false, error: "only the host can hand off control" });
});

test("listSharedSessions marks which local session each shared session belongs to", async () => {
  const rows = await listSharedSessions(ports());
  expect(rows).toEqual([{
    multiplayerSessionId: "m1", localSessionId: "s1", connectionName: "web-1", isHost: true,
    participants: [{ userId: "u2", displayName: "Two" }], controlHolder: "u0", controlRequester: null,
  }]);
});
