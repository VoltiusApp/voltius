import { test, expect, vi, beforeEach } from "vitest";
import type { TeamMember } from "@/services/teamService";

const h = vi.hoisted(() => ({
  removeMember: vi.fn(async () => {}),
  addMemberById: vi.fn(async () => {}),
  assignMemberRole: vi.fn(async () => {}),
  loadMembers: vi.fn(async () => {}),
  push: vi.fn(),
}));

vi.mock("@/i18n", () => ({
  default: { t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${JSON.stringify(o)}` : k) },
}));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: {
    getState: () => ({
      removeMember: h.removeMember,
      addMemberById: h.addMemberById,
      assignMemberRole: h.assignMemberRole,
      loadMembers: h.loadMembers,
    }),
  },
}));
vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: { getState: () => ({ push: h.push }) },
}));

import { departMembers, departConsequences, markSelfDeparture, selfDeparture } from "./teamOffboarding";

const member = (id: string): TeamMember => ({
  team_id: "t1",
  user_id: id,
  handle: `user-${id}`,
  invited_by_display_name: null,
  joined_at: "2024-01-01",
  public_key: "",
  role_ids: ["r1"],
});

beforeEach(() => {
  h.removeMember.mockClear();
  h.addMemberById.mockClear();
  h.assignMemberRole.mockClear();
  h.loadMembers.mockClear();
  h.push.mockClear();
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

test("undo restores every member and their roles", async () => {
  await departMembers("t1", [member("a"), member("b")], { mode: "remove" });

  await h.push.mock.calls[0][0].undo();

  expect(h.addMemberById).toHaveBeenCalledWith("t1", "a");
  expect(h.addMemberById).toHaveBeenCalledWith("t1", "b");
  expect(h.assignMemberRole).toHaveBeenCalledWith("t1", "a", "r1");
  expect(h.loadMembers).toHaveBeenCalledWith("t1");
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
