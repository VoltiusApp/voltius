import { test, expect, vi, beforeEach, describe } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), appFetch: vi.fn(), load: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/http", () => ({ appFetch: h.appFetch }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/subscriptionStore", () => ({ useSubscriptionStore: { getState: () => ({ load: h.load }) } }));

import {
  listTeams, listRoles, listPendingInvitations, fetchMyPendingInvitations, searchUsers, listMemberRoles,
  createTeam, addMember, addMemberById, removeMember,
  assignMemberRole, removeMemberRole, createRole, updateRole, deleteRole,
  inviteByEmail, getMyUserId,
} from "./teamService";

function jwt(sub = "me"): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64({ exp: Math.floor(Date.now() / 1000) + 3600, sub })}.sig`;
}
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const err = (status: number) => ({ ok: false, status, json: async () => ({}) });

// default: connected + valid jwt
function connected() {
  h.invoke.mockImplementation(async (cmd: string, args: { key: string }) => {
    if (cmd !== "keychain_get") return null;
    return { jwt: jwt(), server_url: "https://s" }[args.key] ?? null;
  });
}
// no server url
function offline() {
  h.invoke.mockImplementation(async (_cmd: string, args: { key: string }) =>
    args.key === "jwt" ? jwt() : null);
}

beforeEach(() => { Object.values(h).forEach((m) => m.mockReset?.()); h.load.mockResolvedValue(undefined); });

describe("no-server split", () => {
  test("list* return [] when no server url", async () => {
    offline();
    expect(await listTeams()).toEqual([]);
    expect(await listRoles("t1")).toEqual([]);
    expect(await listPendingInvitations("t1")).toEqual([]);
    expect(await fetchMyPendingInvitations()).toEqual([]);
    expect(await listMemberRoles("t1", "u1")).toEqual([]);
    expect(await searchUsers("ab")).toEqual([]);
    expect(h.appFetch).not.toHaveBeenCalled();
  });
  test("mutating calls throw notConnectedToServer when no server url", async () => {
    offline();
    await expect(createTeam("x")).rejects.toThrow("common.error.notConnectedToServer");
    await expect(removeMember("t1", "u1")).rejects.toThrow("common.error.notConnectedToServer");
    await expect(assignMemberRole("t1", "u1", "r1")).rejects.toThrow("common.error.notConnectedToServer");
  });
});

describe("request shaping", () => {
  test("addMemberById POST body carries user_id + role", async () => {
    connected();
    h.appFetch.mockResolvedValue(okJson({ status: "pending" }));
    const out = await addMemberById("t1", "u2", "editor");
    expect(out).toEqual({ status: "pending" });
    const [url, init] = h.appFetch.mock.calls[0];
    expect(url).toBe("https://s/v1/teams/t1/members");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ user_id: "u2", role: "editor" });
  });
  test("assignMemberRole POST body carries role_id + correct URL", async () => {
    connected();
    h.appFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await assignMemberRole("t1", "u2", "r5");
    const [url, init] = h.appFetch.mock.calls[0];
    expect(url).toBe("https://s/v1/teams/t1/members/u2/roles");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ role_id: "r5" });
  });
  test("updateRole PATCHes the partial updates object", async () => {
    connected();
    h.appFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) });
    await updateRole("t1", "r1", { name: "Ops", position: 2 });
    const [url, init] = h.appFetch.mock.calls[0];
    expect(url).toBe("https://s/v1/teams/t1/roles/r1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({ name: "Ops", position: 2 });
  });
  test("searchUsers short-circuits under 2 chars, encodes query otherwise", async () => {
    connected();
    expect(await searchUsers("a")).toEqual([]);
    expect(h.appFetch).not.toHaveBeenCalled();
    h.appFetch.mockResolvedValue(okJson([{ user_id: "u1" }]));
    await searchUsers("a b&c");
    expect(h.appFetch.mock.calls[0][0]).toBe("https://s/v1/users/search?q=a%20b%26c");
  });
  test("inviteByEmail 204 → {status:'added'}, 200 → json body", async () => {
    connected();
    h.appFetch.mockResolvedValueOnce({ ok: true, status: 204, json: async () => ({}) });
    expect(await inviteByEmail("t1", "x@y.z")).toEqual({ status: "added" });
    h.appFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ status: "invited" }) });
    expect(await inviteByEmail("t1", "x@y.z")).toEqual({ status: "invited" });
  });
});

describe("error mapping", () => {
  test("addMember 404 → userNotFoundVoltiusAccount, other → generic", async () => {
    connected();
    h.appFetch.mockResolvedValueOnce(err(404));
    await expect(addMember("t1", "x@y.z")).rejects.toThrow("common.error.userNotFoundVoltiusAccount");
    h.appFetch.mockResolvedValueOnce(err(500));
    await expect(addMember("t1", "x@y.z")).rejects.toThrow("common.error.failedToAddMember");
  });
  test("addMemberById 402 → seatLimitReached WITH .code === 402", async () => {
    connected();
    h.appFetch.mockResolvedValueOnce(err(402));
    await expect(addMemberById("t1", "u2")).rejects.toMatchObject({
      message: "common.error.seatLimitReached", code: 402,
    });
  });
  test("addMemberById 404 → userNotFound, 400 → cannotAddYourself", async () => {
    connected();
    h.appFetch.mockResolvedValueOnce(err(404));
    await expect(addMemberById("t1", "u2")).rejects.toThrow("common.error.userNotFound");
    h.appFetch.mockResolvedValueOnce(err(400));
    await expect(addMemberById("t1", "u2")).rejects.toThrow("common.error.cannotAddYourself");
  });
  test("assignMemberRole 403 → insufficientPermissionAssignRoles", async () => {
    connected();
    h.appFetch.mockResolvedValueOnce(err(403));
    await expect(assignMemberRole("t1", "u2", "r1")).rejects.toThrow("common.error.insufficientPermissionAssignRoles");
  });
  test("removeMemberRole 403 → cannotRemoveThisRole", async () => {
    connected();
    h.appFetch.mockResolvedValueOnce(err(403));
    await expect(removeMemberRole("t1", "u2", "r1")).rejects.toThrow("common.error.cannotRemoveThisRole");
  });
  test("createRole 409 → roleNameExists", async () => {
    connected();
    h.appFetch.mockResolvedValueOnce(err(409));
    await expect(createRole("t1", "dup", 0)).rejects.toThrow("common.error.roleNameExists");
  });
  test("updateRole 403 → cannotModifyBuiltinRoles; deleteRole 403 → cannotDeleteBuiltinRoles", async () => {
    connected();
    h.appFetch.mockResolvedValueOnce(err(403));
    await expect(updateRole("t1", "r1", { name: "x" })).rejects.toThrow("common.error.cannotModifyBuiltinRoles");
    h.appFetch.mockResolvedValueOnce(err(403));
    await expect(deleteRole("t1", "r1")).rejects.toThrow("common.error.cannotDeleteBuiltinRoles");
  });
  test("inviteByEmail 402 → seatLimitReached (.code 402), 403 → noPermissionInviteMembers", async () => {
    connected();
    h.appFetch.mockResolvedValueOnce(err(402));
    await expect(inviteByEmail("t1", "x@y.z")).rejects.toMatchObject({ message: "common.error.seatLimitReached", code: 402 });
    h.appFetch.mockResolvedValueOnce(err(403));
    await expect(inviteByEmail("t1", "x@y.z")).rejects.toThrow("common.error.noPermissionInviteMembers");
  });
});

describe("getMyUserId", () => {
  test("returns sub from jwt", async () => {
    h.invoke.mockImplementation(async (_c: string, a: { key: string }) => (a.key === "jwt" ? jwt("user-42") : null));
    expect(await getMyUserId()).toBe("user-42");
  });
  test("no jwt → null; malformed jwt → null", async () => {
    h.invoke.mockResolvedValue(null);
    expect(await getMyUserId()).toBeNull();
    h.invoke.mockResolvedValue("garbage");
    expect(await getMyUserId()).toBeNull();
  });
});
