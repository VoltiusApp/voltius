import { test, expect, vi, beforeEach } from "vitest";
import type { TeamRole } from "@/stores/teamStore";

const h = vi.hoisted(() => ({
  addMemberById: vi.fn(),
  assignMemberRole: vi.fn(),
  inviteByEmail: vi.fn(),
}));

vi.mock("@/stores/teamStore", () => ({
  useTeamStore: {
    getState: () => ({ addMemberById: h.addMemberById, assignMemberRole: h.assignMemberRole }),
  },
}));
vi.mock("@/services/teamService", () => ({ inviteByEmail: h.inviteByEmail }));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import { inviteUserById, inviteUserWithRoles, inviteByEmailAddress, inviteFailureReason } from "./vaultShare";

beforeEach(() => {
  h.addMemberById.mockReset();
  h.assignMemberRole.mockReset();
  h.inviteByEmail.mockReset();
});

test("the chosen role travels with the invitation", async () => {
  h.addMemberById.mockResolvedValue({ status: "pending" });
  await inviteUserById({ teamId: "t1", userId: "u1", handle: "bob-builder", roleName: "editor", roleId: "r-editor" });
  expect(h.addMemberById).toHaveBeenCalledWith("t1", "u1", "editor");
});

test("a pending invitee never gets a role assignment", async () => {
  h.addMemberById.mockResolvedValue({ status: "pending" });
  await inviteUserById({ teamId: "t1", userId: "u1", handle: "bob-builder", roleName: "editor", roleId: "r-editor" });
  expect(h.assignMemberRole).not.toHaveBeenCalled();
});

test("an already-member does get the role assigned", async () => {
  h.addMemberById.mockResolvedValue({ status: "already_member" });
  await inviteUserById({ teamId: "t1", userId: "u1", handle: "bob-builder", roleName: "editor", roleId: "r-editor" });
  expect(h.assignMemberRole).toHaveBeenCalledWith("t1", "u1", "r-editor");
});

test("failures propagate instead of being swallowed", async () => {
  h.addMemberById.mockRejectedValue(new Error("boom"));
  await expect(
    inviteUserById({ teamId: "t1", userId: "u1", handle: "bob-builder", roleName: "editor", roleId: "r-editor" }),
  ).rejects.toThrow("boom");
});

test("email invites carry the role too", async () => {
  h.inviteByEmail.mockResolvedValue({ status: "invited" });
  await inviteByEmailAddress({ teamId: "t1", email: "dave@example.com", roleName: "connect-only" });
  expect(h.inviteByEmail).toHaveBeenCalledWith("t1", "dave@example.com", "connect-only");
});

test("a transport failure's raw URL is never returned as the reason", () => {
  const raw = "error sending request for url (http://v68-server:8080/v1/teams/a5c2d19d/invite)";
  const reason = inviteFailureReason(new Error(raw));
  expect(reason).not.toContain("http");
  expect(reason).not.toBe(raw);
});

test("a real HTTP failure's short, already-translated message passes through unchanged", () => {
  expect(inviteFailureReason(new Error("User not found"))).toBe("User not found");
});

const ROLES: TeamRole[] = [
  { id: "r-owner", team_id: "t1", name: "owner", is_builtin: true, permissions: 0, position: 0, created_at: "" },
  { id: "r-mem", team_id: "t1", name: "member", is_builtin: true, permissions: 0, position: 1, created_at: "" },
  { id: "r-editor", team_id: "t1", name: "editor", is_builtin: true, permissions: 0, position: 2, created_at: "" },
  { id: "r-connect", team_id: "t1", name: "connect-only", is_builtin: true, permissions: 0, position: 3, created_at: "" },
];

const withRoles = (roleIds: string[]) =>
  inviteUserWithRoles({ teamId: "t1", userId: "u1", handle: "bob-builder", roleIds, roles: ROLES });

test("the first chosen role travels with the invitation", async () => {
  h.addMemberById.mockResolvedValue({ status: "pending" });
  await withRoles(["r-editor", "r-mem"]);
  expect(h.addMemberById).toHaveBeenCalledWith("t1", "u1", "editor");
});

test("a pending invitee gets no role assignment, however many roles were ticked", async () => {
  h.addMemberById.mockResolvedValue({ status: "pending" });
  await withRoles(["r-editor", "r-mem"]);
  expect(h.assignMemberRole).not.toHaveBeenCalled();
});

test("an already-member gets every ticked role, the first one included", async () => {
  h.addMemberById.mockResolvedValue({ status: "already_member" });
  h.assignMemberRole.mockResolvedValue(undefined);
  await withRoles(["r-editor", "r-mem"]);
  expect(h.assignMemberRole).toHaveBeenCalledWith("t1", "u1", "r-editor");
  expect(h.assignMemberRole).toHaveBeenCalledWith("t1", "u1", "r-mem");
});

test("no role ticked falls back to the least-privileged role, never member", async () => {
  h.addMemberById.mockResolvedValue({ status: "pending" });
  await withRoles([]);
  expect(h.addMemberById).toHaveBeenCalledWith("t1", "u1", "connect-only");
});

test("an unknown role id is not treated as a choice", async () => {
  h.addMemberById.mockResolvedValue({ status: "pending" });
  await withRoles(["r-gone"]);
  expect(h.addMemberById).toHaveBeenCalledWith("t1", "u1", "connect-only");
});

test("with no assignable role at all, nothing is assigned after an already_member result", async () => {
  h.addMemberById.mockResolvedValue({ status: "already_member" });
  await inviteUserWithRoles({ teamId: "t1", userId: "u1", handle: "bob-builder", roleIds: [], roles: [] });
  expect(h.addMemberById).toHaveBeenCalledWith("t1", "u1", "connect-only");
  expect(h.assignMemberRole).not.toHaveBeenCalled();
});
