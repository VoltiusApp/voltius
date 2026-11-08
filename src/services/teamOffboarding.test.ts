import { test, expect, vi, beforeEach } from "vitest";
import type { TeamMember } from "@/services/teamService";

const h = vi.hoisted(() => ({
  removeMember: vi.fn(async (_teamId: string, _userId: string) => {}),
  addMemberById: vi.fn(async () => {}),
  assignMemberRole: vi.fn(async () => {}),
  loadMembers: vi.fn(async () => {}),
  push: vi.fn(),
  action: undefined as undefined | { run: () => Promise<unknown>; warning?: (r: unknown) => string | null },
  result: undefined as unknown,
}));

vi.mock("@/i18n", () => ({
  default: { t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) },
}));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown>; warning?: (r: unknown) => string | null }) => {
    h.action = o;
    h.result = await o.run();
    return h.result;
  },
}));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: {
    getState: () => ({
      removeMember: h.removeMember,
      addMemberById: h.addMemberById,
      assignMemberRole: h.assignMemberRole,
      loadMembers: h.loadMembers,
      rolesByTeam: {
        t1: [
          { id: "r1", name: "member", is_builtin: true },
          { id: "r2", name: "connect-only", is_builtin: true },
          { id: "r3", name: "Auditors", is_builtin: false },
          { id: "r4", name: "owner", is_builtin: true },
        ],
      },
    }),
  },
}));
vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: { getState: () => ({ push: h.push }) },
}));

import { departMembers, departConsequences, markSelfDeparture, selfDeparture } from "./teamOffboarding";

const member = (id: string, role_ids = ["r1"]): TeamMember => ({
  team_id: "t1",
  user_id: id,
  handle: `user-${id}`,
  invited_by_display_name: null,
  joined_at: "2024-01-01",
  public_key: "",
  role_ids,
});

beforeEach(() => {
  h.removeMember.mockClear();
  h.addMemberById.mockClear();
  h.assignMemberRole.mockClear();
  h.loadMembers.mockClear();
  h.push.mockClear();
  h.removeMember.mockImplementation(async () => {});
  h.action = undefined;
  h.result = undefined;
});

test("removes every member passed to it", async () => {
  await departMembers("t1", [member("a"), member("b")], { mode: "remove" });

  expect(h.removeMember).toHaveBeenCalledTimes(2);
  expect(h.removeMember).toHaveBeenCalledWith("t1", "a");
  expect(h.removeMember).toHaveBeenCalledWith("t1", "b");
});

test("pushes exactly one undo entry for a bulk removal", async () => {
  await departMembers("t1", [member("a"), member("b")], { mode: "remove" });

  expect(h.push).toHaveBeenCalledTimes(1);
});

test("undo re-invites every member with the role they had", async () => {
  await departMembers("t1", [member("a"), member("b", ["r2"])], { mode: "remove" });

  await h.push.mock.calls[0][0].undo();

  expect(h.addMemberById).toHaveBeenCalledWith("t1", "a", "member");
  expect(h.addMemberById).toHaveBeenCalledWith("t1", "b", "connect-only");
  expect(h.assignMemberRole).not.toHaveBeenCalled();
  expect(h.loadMembers).toHaveBeenCalledWith("t1");
});

test.each([
  ["several roles", ["r1", "r2"]],
  ["a custom role", ["r3"]],
  ["no role", []],
  ["the owner role", ["r4"]],
])("undo refuses, and re-invites nobody, when a member held %s (#785)", async (_label, roleIds) => {
  await departMembers("t1", [member("a"), member("b", roleIds)], { mode: "remove" });

  await expect(h.push.mock.calls[0][0].undo()).rejects.toThrow("members.error.undoRolesNotRestorable");
  expect(h.addMemberById).not.toHaveBeenCalled();
});

test("leaving pushes no undo entry", async () => {
  // You cannot re-add yourself to a team you just left.
  await departMembers("t1", [member("me")], { mode: "leave" });

  expect(h.removeMember).toHaveBeenCalledWith("t1", "me");
  expect(h.push).not.toHaveBeenCalled();
});

test("an empty selection is a no-op", async () => {
  await departMembers("t1", [], { mode: "remove" });

  expect(h.removeMember).not.toHaveBeenCalled();
  expect(h.push).not.toHaveBeenCalled();
});

test("onDone fires after the removal completes", async () => {
  const onDone = vi.fn();

  await departMembers("t1", [member("a")], { mode: "remove", onDone });

  expect(onDone).toHaveBeenCalled();
});

test("consequences differ between removing someone and leaving yourself", () => {
  const remove = departConsequences("remove", ["ana", "bo"]);
  const leave = departConsequences("leave", ["me"]);

  expect(remove.points.length).toBeGreaterThan(0);
  expect(remove.title).toContain("removeTitle");
  expect(remove.confirmLabel).toContain("removeConfirm");
  expect(leave.title).toContain("leaveTitle");
  expect(leave.confirmLabel).toContain("leaveConfirm");
  expect(remove.points).not.toEqual(leave.points);
});

test("consequences state that a departing member keeps what they already saw", () => {
  // The honest half: removal ends future access, it does not un-see anything.
  const remove = departConsequences("remove", ["ana"]);

  expect(remove.points.some((p) => p.includes("pointAlreadySeen"))).toBe(true);
});

test("a voluntary leave is marked so the removal notice can be suppressed", async () => {
  await departMembers("t9", [member("me")], { mode: "leave" });
  expect(selfDeparture("t9")).toBe("leave");

  await departMembers("t8", [member("ana")], { mode: "remove" });
  expect(selfDeparture("t8")).toBeUndefined();
});

test("a team deleted by its own owner is marked apart from a leave", async () => {
  // The two are not interchangeable: a leave still needs the full offboarding,
  // a self-delete needs none of it (#249).
  markSelfDeparture("t7", "self-deleted");

  expect(selfDeparture("t7")).toBe("self-deleted");
  expect(selfDeparture("t6")).toBeUndefined();
});

test("the undo label names a member by their member name", async () => {
  await departMembers("t1", [{ ...member("a"), member_name: "Jan" }, member("b")], { mode: "remove" });

  expect(h.push.mock.calls[0][0].label).toContain("Jan, @user-b");
});

const failFor = (...ids: string[]) =>
  h.removeMember.mockImplementation(async (_t: string, userId: string) => {
    if (ids.includes(userId)) throw new Error(`boom-${userId}`);
  });

test("a failed removal does not stop the rest of the batch (#786)", async () => {
  failFor("b");
  await departMembers("t1", [member("a"), member("b"), member("c")], { mode: "remove" });
  expect(h.removeMember.mock.calls.map((c) => c[1])).toEqual(["a", "b", "c"]);
});

test("a partial removal warns with who was removed and who was not", async () => {
  failFor("b");
  await departMembers("t1", [member("a"), member("b"), member("c")], { mode: "remove" });
  const warning = h.action?.warning?.(h.result);
  expect(warning).toContain("members.error.removePartial");
  expect(warning).toContain('"removed":"@user-a, @user-c"');
  expect(warning).toContain('"failed":"@user-b"');
});

test("a full removal does not warn", async () => {
  await departMembers("t1", [member("a"), member("b")], { mode: "remove" });
  expect(h.action?.warning?.(h.result) ?? null).toBeNull();
});

test("undo after a partial removal brings back only the members actually removed", async () => {
  failFor("b");
  await departMembers("t1", [member("a"), member("b"), member("c", ["r2"])], { mode: "remove" });
  expect(h.push).toHaveBeenCalledTimes(1);
  const entry = h.push.mock.calls[0][0] as { label: string; undo: () => Promise<void>; redo: () => Promise<void> };
  expect(entry.label).toContain('"count":2');
  await entry.undo();
  expect(h.addMemberById.mock.calls).toEqual([["t1", "a", "member"], ["t1", "c", "connect-only"]]);
  h.removeMember.mockClear();
  await entry.redo();
  expect(h.removeMember.mock.calls.map((c) => c[1])).toEqual(["a", "c"]);
});

test("a partial removal refreshes the member list and still calls onDone", async () => {
  failFor("b");
  const onDone = vi.fn();
  await departMembers("t1", [member("a"), member("b")], { mode: "remove", onDone });
  expect(h.loadMembers).toHaveBeenCalledWith("t1");
  expect(onDone).toHaveBeenCalled();
});

test("when every removal fails, nothing is recorded and the error propagates", async () => {
  failFor("a", "b");
  const onDone = vi.fn();
  await expect(departMembers("t1", [member("a"), member("b")], { mode: "remove", onDone })).rejects.toThrow("boom-a");
  expect(h.push).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
});
