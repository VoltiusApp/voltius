import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { TeamMember, TeamRole } from "@/stores/teamStore";

const h = vi.hoisted(() => ({
  assign: vi.fn(),
  remove: vi.fn(),
  removeMember: vi.fn(),
  addMemberById: vi.fn(),
  loadMembers: vi.fn(),
  push: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/shared/Panel", () => ({
  PanelShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelHeader: ({ subtitle }: { subtitle?: React.ReactNode }) => <div>{subtitle}</div>,
  FormSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelHeaderIconButton: () => null,
}));
vi.mock("@/components/settings/sections/RolesSection", () => ({
  RoleModal: () => null,
  PERM_META: {},
  TeamRolesPanel: () => null,
}));
vi.mock("@/stores/teamStore", () => {
  const state = {
    assignMemberRole: h.assign,
    removeMemberRole: h.remove,
    removeMember: h.removeMember,
    addMemberById: h.addMemberById,
    loadMembers: h.loadMembers,
  };
  const useTeamStore = Object.assign(
    (sel: (s: typeof state) => unknown) => sel(state),
    { getState: () => state },
  );
  return { useTeamStore };
});
vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: (sel: (s: { push: typeof h.push }) => unknown) => sel({ push: h.push }),
}));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));

import { MemberDetailPanel } from "./MembersPage";

const baseMember: TeamMember = {
  team_id: "t1",
  user_id: "u1",
  invited_by_display_name: null,
  joined_at: "2024-01-01T00:00:00Z",
  display_name: "Ann",
  public_key: "pk",
  role_ids: ["r-mem"],
};

const teamRoles: TeamRole[] = [
  { id: "r-owner", team_id: "t1", name: "owner", is_builtin: true, permissions: 0, position: 0, created_at: "" },
  { id: "r-mem", team_id: "t1", name: "member", is_builtin: true, permissions: 0, position: 1, created_at: "" },
  { id: "r-ed", team_id: "t1", name: "editor", is_builtin: false, permissions: 0, position: 2, created_at: "" },
];

const baseProps = {
  member: baseMember,
  isMe: false,
  teamId: "t1",
  teamRoles,
  canManageMembers: true,
  isTargetOwner: false,
  onClose: vi.fn(),
  onUpdated: vi.fn(),
};

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  h.assign.mockResolvedValue(undefined);
  h.remove.mockResolvedValue(undefined);
  h.removeMember.mockResolvedValue(undefined);
  h.addMemberById.mockResolvedValue(undefined);
  h.loadMembers.mockResolvedValue(undefined);
  baseProps.onClose = vi.fn();
  baseProps.onUpdated = vi.fn();
});
afterEach(() => cleanup());

test("canManageMembers=false: no role-toggle buttons and no remove button", () => {
  render(<MemberDetailPanel {...baseProps} canManageMembers={false} />);
  expect(screen.queryByRole("button", { name: "editor" })).toBeNull();
  expect(screen.queryByRole("button", { name: "member" })).toBeNull();
  expect(screen.queryByRole("button", { name: "members.removeFromTeam" })).toBeNull();
});

test("isMe=true: role-toggle buttons and remove button absent even though canManageMembers=true", () => {
  render(<MemberDetailPanel {...baseProps} isMe={true} />);
  expect(screen.queryByRole("button", { name: "editor" })).toBeNull();
  expect(screen.queryByRole("button", { name: "member" })).toBeNull();
  expect(screen.queryByRole("button", { name: "members.removeFromTeam" })).toBeNull();
});

// The JSX filters `r.is_builtin && r.name === "owner"` out of the toggle list entirely
// (MembersPage.tsx ~line 528), for every viewer, independent of isTargetOwner/canManageMembers.
// That means the "owner" toggle is never rendered, so handleToggleRole's
// cannotRemoveOwnerRole guard is unreachable via the UI as currently written — there is no
// button to click that would exercise it. We assert the (real, reachable) guarantee that
// actually protects the owner role here: it never renders as a toggle, for anyone.
test("isTargetOwner=true with owner role: remove button absent; owner role never renders as a toggle", () => {
  const ownerMember = { ...baseMember, role_ids: ["r-owner"] };
  render(<MemberDetailPanel {...baseProps} member={ownerMember} isTargetOwner={true} />);
  expect(screen.queryByRole("button", { name: "members.removeFromTeam" })).toBeNull();
  expect(screen.queryByRole("button", { name: "owner" })).toBeNull();
  expect(h.remove).not.toHaveBeenCalled();
});

test("assign path: click editor toggle when member lacks it", async () => {
  render(<MemberDetailPanel {...baseProps} />);
  fireEvent.click(screen.getByRole("button", { name: "editor" }));
  await waitFor(() => expect(baseProps.onUpdated).toHaveBeenCalled());
  expect(h.assign).toHaveBeenCalledWith("t1", "u1", "r-ed");
  expect(h.remove).not.toHaveBeenCalled();
  expect(h.push).toHaveBeenCalledWith(expect.objectContaining({ label: "members.history.assignRole" }));
});

test("remove-role path: click member toggle when member has it", async () => {
  render(<MemberDetailPanel {...baseProps} />);
  fireEvent.click(screen.getByRole("button", { name: "member" }));
  await waitFor(() => expect(baseProps.onUpdated).toHaveBeenCalled());
  expect(h.remove).toHaveBeenCalledWith("t1", "u1", "r-mem");
  expect(h.assign).not.toHaveBeenCalled();
  expect(h.push).toHaveBeenCalledWith(expect.objectContaining({ label: "members.history.removeRole" }));
});

test("remove-member two-step confirm flow", async () => {
  render(<MemberDetailPanel {...baseProps} />);
  fireEvent.click(screen.getByRole("button", { name: "members.removeFromTeam" }));
  expect(h.removeMember).not.toHaveBeenCalled();
  expect(await screen.findByRole("button", { name: "members.confirmRemoval" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "members.confirmRemoval" }));
  await waitFor(() => expect(baseProps.onUpdated).toHaveBeenCalled());
  expect(h.removeMember).toHaveBeenCalledWith("t1", "u1");
  expect(baseProps.onClose).toHaveBeenCalled();
  expect(h.push).toHaveBeenCalledWith(expect.objectContaining({ label: "members.history.remove" }));
});

test("remove undo closure: re-adds member, reassigns each snapshot role, reloads", async () => {
  render(<MemberDetailPanel {...baseProps} />);
  fireEvent.click(screen.getByRole("button", { name: "members.removeFromTeam" }));
  fireEvent.click(await screen.findByRole("button", { name: "members.confirmRemoval" }));
  await waitFor(() => expect(h.push).toHaveBeenCalled());

  const entry = h.push.mock.calls[0][0] as { undo: () => Promise<void> };
  await entry.undo();

  expect(h.addMemberById).toHaveBeenCalledWith("t1", "u1");
  expect(h.assign).toHaveBeenCalledTimes(1);
  expect(h.assign).toHaveBeenCalledWith("t1", "u1", "r-mem");
  expect(h.loadMembers).toHaveBeenCalledWith("t1");
  expect(h.addMemberById.mock.invocationCallOrder[0]).toBeLessThan(h.assign.mock.invocationCallOrder[0]);
  expect(h.assign.mock.invocationCallOrder[0]).toBeLessThan(h.loadMembers.mock.invocationCallOrder[0]);
});
