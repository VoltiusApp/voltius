import { test, expect, vi, beforeEach } from "vitest";

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

import { inviteUserById, inviteByEmailAddress } from "./vaultShare";

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
