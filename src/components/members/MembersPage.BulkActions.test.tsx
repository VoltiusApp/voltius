import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";

const h = vi.hoisted(() => ({
  getMyUserId: vi.fn(),
  getMyEmail: vi.fn(),
  loadTeams: vi.fn(),
  loadMembers: vi.fn(),
  loadRoles: vi.fn(),
  loadPendingInvitations: vi.fn(),
  addMemberById: vi.fn(),
  assignMemberRole: vi.fn(),
  removeMemberRole: vi.fn(),
  removeMember: vi.fn(),
  push: vi.fn(),
  teamRoles: [
    { id: "r-owner", team_id: "t1", name: "owner", is_builtin: true, permissions: 0, position: 0, created_at: "" },
    { id: "r-mem", team_id: "t1", name: "member", is_builtin: true, permissions: 0, position: 1, created_at: "" },
    { id: "r-ed", team_id: "t1", name: "editor", is_builtin: false, permissions: 0, position: 2, created_at: "" },
  ],
  members: [
    { team_id: "t1", user_id: "me", invited_by_display_name: null, joined_at: "2024-01-01T00:00:00Z", display_name: "Me", public_key: "pk", role_ids: ["r-mem"] },
    { team_id: "t1", user_id: "u1", invited_by_display_name: null, joined_at: "2024-01-02T00:00:00Z", display_name: "Ann", public_key: "pk", role_ids: ["r-mem", "r-ed"] },
    { team_id: "t1", user_id: "u2", invited_by_display_name: null, joined_at: "2024-01-03T00:00:00Z", display_name: "Bob", public_key: "pk", role_ids: ["r-mem"] },
  ],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/shared/StatusDot", () => ({ StatusDot: () => null }));
vi.mock("@/components/shared/Panel", () => ({
  PanelShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PanelHeaderIconButton: () => null,
  FormSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/SidePanelLayout", () => ({
  SidePanelLayout: ({ panel, children }: { panel: React.ReactNode; children: React.ReactNode }) => (
    <div>{panel}{children}</div>
  ),
}));
vi.mock("@/components/shared/DragSelectSurface", () => ({
  DragSelectSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ToolbarViewControls", () => ({ ToolbarViewControls: () => null }));

// Exposes each card's onClick (selection) and flattens context-menu / bulk-menu
// items into clickable leaf buttons so their handlers can be invoked directly.
function renderMenu(items: ContextMenuItem[] | undefined, prefix: string): React.ReactNode {
  if (!items) return null;
  return items.map((it, i) => (
    <span key={`${prefix}::${it.label}::${i}`}>
      {it.onClick && (
        <button data-testid={`${prefix}::${it.label}`} onClick={() => it.onClick!()}>
          {it.label}
        </button>
      )}
      {it.children && renderMenu(it.children, `${prefix}::${it.label}`)}
    </span>
  ));
}
vi.mock("@/components/shared/BaseCard", () => ({
  BaseCard: (props: Record<string, unknown>) => {
    const id = props["data-selectable-id"] as string | undefined;
    return (
      <div>
        <button
          data-testid={`card-${id}`}
          onClick={props.onClick as React.MouseEventHandler}
          onDoubleClick={props.onDoubleClick as React.MouseEventHandler}
        >
          {id}
        </button>
        {renderMenu(props.contextMenuItems as ContextMenuItem[] | undefined, `ctx-${id}`)}
        {renderMenu(props.bulkContextMenuItems as ContextMenuItem[] | undefined, `bulk-${id}`)}
      </div>
    );
  },
}));

vi.mock("@/components/settings/BuySeatsModal", () => ({ default: () => null }));
vi.mock("@/components/settings/sections/RolesSection", () => ({
  RoleModal: () => null,
  PERM_META: {},
  TeamRolesPanel: () => null,
}));
vi.mock("@/hooks/useListKeyNav", () => ({ useListKeyNav: () => ({ focusedId: null, setFocusedId: () => {} }) }));
vi.mock("@/hooks/usePermission", () => ({
  PERM_BITS: { MANAGE_MEMBERS: 1, MANAGE_ROLES: 2, INVITE_MEMBERS: 4 },
  effectivePermissions: () => 7,
  hasBuiltinRole: (m: { role_ids: string[] }) => m.role_ids.includes("r-owner"),
}));
vi.mock("@/services/teamService", () => ({
  searchUsers: vi.fn(),
  getMyUserId: h.getMyUserId,
  getMyEmail: h.getMyEmail,
  inviteByEmail: vi.fn(),
  revokePendingInvitation: vi.fn(),
}));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/services/teamVaultActivation", () => ({ markTeamVaultLoadedAfterLocalActivation: vi.fn() }));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn() }));
vi.mock("@/services/teamVaultSync", () => ({ initTeamVaultKey: vi.fn() }));
vi.mock("@/stores/teamVaultStateStore", () => ({ useTeamVaultStateStore: { getState: () => ({}) } }));

vi.mock("@/stores/vaultStore", () => {
  const state = {
    selectedVaultIds: ["v1"],
    vaults: [{ id: "v1", name: "V", teamId: "t1" }],
    setVaultTeamId: vi.fn(),
  };
  const useVaultStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  );
  return { useVaultStore };
});

vi.mock("@/stores/teamStore", () => {
  const state = {
    teams: [],
    loadTeams: h.loadTeams,
    membersByTeam: { t1: h.members },
    loadMembers: h.loadMembers,
    rolesByTeam: { t1: h.teamRoles },
    loadRoles: h.loadRoles,
    pendingInvitationsByTeam: {},
    loadPendingInvitations: h.loadPendingInvitations,
    createTeam: vi.fn(),
    addMemberById: h.addMemberById,
    assignMemberRole: h.assignMemberRole,
    removeMemberRole: h.removeMemberRole,
    removeMember: h.removeMember,
  };
  const useTeamStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  );
  return { useTeamStore };
});
vi.mock("@/stores/subscriptionStore", () => {
  const state = { isTeams: true, accountMode: "server", usedSeats: 1, totalSeats: 5, load: vi.fn() };
  const useSubscriptionStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  );
  return { useSubscriptionStore };
});
vi.mock("@/stores/uiStore", () => {
  const state = {
    membersLayoutMode: "list",
    membersSortMode: "name-asc",
    setMembersLayoutMode: vi.fn(),
    setMembersSortMode: vi.fn(),
    membersInvitePending: false,
    clearMembersInvitePending: vi.fn(),
    openSettings: vi.fn(),
    openCloudAuth: vi.fn(),
  };
  const useUIStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  );
  return { useUIStore };
});
vi.mock("@/stores/teamSessionStore", () => {
  const state = { activeSessions: [], startSharing: vi.fn() };
  const useTeamSessionStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  );
  return { useTeamSessionStore };
});
vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: (sel: (s: { push: typeof h.push }) => unknown) => sel({ push: h.push }),
}));

import MembersPage from "./MembersPage";

beforeEach(() => {
  Object.values(h).forEach((v) => { if (typeof v === "function" && "mockReset" in v) (v as ReturnType<typeof vi.fn>).mockReset(); });
  h.getMyUserId.mockResolvedValue("me");
  h.getMyEmail.mockResolvedValue("me@x.com");
  h.loadTeams.mockResolvedValue(undefined);
  h.loadMembers.mockResolvedValue(undefined);
  h.loadRoles.mockResolvedValue(undefined);
  h.loadPendingInvitations.mockResolvedValue(undefined);
  h.addMemberById.mockResolvedValue(undefined);
  h.assignMemberRole.mockResolvedValue(undefined);
  h.removeMemberRole.mockResolvedValue(undefined);
  h.removeMember.mockResolvedValue(undefined);
});
afterEach(() => cleanup());

async function renderPage() {
  render(<MembersPage />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

/** Ctrl-clicks u1 and u2 so selectedIdSet = {u1, u2} (bulk menus become active). */
function selectU1U2() {
  fireEvent.click(screen.getByTestId("card-u1"), { ctrlKey: true });
  fireEvent.click(screen.getByTestId("card-u2"), { ctrlKey: true });
}

test("single member card renders; no bulk menu until 2+ selected", async () => {
  await renderPage();
  expect(screen.getByTestId("card-u1")).toBeTruthy();
  // one selected -> bulkContextMenuItems undefined -> no bulk kick button
  fireEvent.click(screen.getByTestId("card-u1"), { ctrlKey: true });
  expect(screen.queryByTestId("bulk-u1::members.contextMenu.kickBulk")).toBeNull();

  fireEvent.click(screen.getByTestId("card-u2"), { ctrlKey: true });
  expect(screen.getByTestId("bulk-u1::members.contextMenu.kickBulk")).toBeTruthy();
});

test("bulk kick: removeMember for both selected, push removeBulk, reload", async () => {
  await renderPage();
  selectU1U2();
  h.loadMembers.mockClear();
  fireEvent.click(screen.getByTestId("bulk-u1::members.contextMenu.kickBulk"));

  await waitFor(() => expect(h.push).toHaveBeenCalled());
  expect(h.removeMember).toHaveBeenCalledWith("t1", "u1");
  expect(h.removeMember).toHaveBeenCalledWith("t1", "u2");
  expect(h.removeMember).toHaveBeenCalledTimes(2);
  expect(h.push).toHaveBeenCalledWith(expect.objectContaining({ label: "members.history.removeBulk" }));
  expect(h.loadMembers).toHaveBeenCalledWith("t1");
});

test("bulk kick undo closure: re-adds each snapshot, reassigns roles, reloads", async () => {
  await renderPage();
  selectU1U2();
  fireEvent.click(screen.getByTestId("bulk-u1::members.contextMenu.kickBulk"));
  await waitFor(() => expect(h.push).toHaveBeenCalled());

  const entry = h.push.mock.calls[0][0] as { undo: () => Promise<void> };
  h.loadMembers.mockClear();
  await entry.undo();

  expect(h.addMemberById).toHaveBeenCalledWith("t1", "u1");
  expect(h.addMemberById).toHaveBeenCalledWith("t1", "u2");
  // u1 has r-mem+r-ed, u2 has r-mem -> 3 role reassignments total
  expect(h.assignMemberRole).toHaveBeenCalledTimes(3);
  expect(h.loadMembers).toHaveBeenCalledWith("t1");
});

test("bulk assign role: assignMemberRole(editor) for both, push assignRoleBulk", async () => {
  await renderPage();
  selectU1U2();
  fireEvent.click(screen.getByTestId("bulk-u1::members.contextMenu.assignRoleBulk::editor"));

  await waitFor(() => expect(h.push).toHaveBeenCalled());
  expect(h.assignMemberRole).toHaveBeenCalledWith("t1", "u1", "r-ed");
  expect(h.assignMemberRole).toHaveBeenCalledWith("t1", "u2", "r-ed");
  expect(h.assignMemberRole).toHaveBeenCalledTimes(2);
  expect(h.push).toHaveBeenCalledWith(expect.objectContaining({ label: "members.history.assignRoleBulk" }));
});

test("bulk remove role: removeMemberRole only for members who have that role", async () => {
  await renderPage();
  selectU1U2();
  fireEvent.click(screen.getByTestId("bulk-u1::members.contextMenu.removeRoleBulk::editor"));

  await waitFor(() => expect(h.push).toHaveBeenCalled());
  // only u1 has r-ed; u2 does not -> exactly one removeMemberRole
  expect(h.removeMemberRole).toHaveBeenCalledWith("t1", "u1", "r-ed");
  expect(h.removeMemberRole).toHaveBeenCalledTimes(1);
  expect(h.push).toHaveBeenCalledWith(expect.objectContaining({ label: "members.history.removeRoleBulk" }));
});

test("single-member context menu kick: removeMember for that one member + push remove", async () => {
  await renderPage();
  h.loadMembers.mockClear();
  fireEvent.click(screen.getByTestId("ctx-u1::members.kick"));

  await waitFor(() => expect(h.push).toHaveBeenCalled());
  expect(h.removeMember).toHaveBeenCalledWith("t1", "u1");
  expect(h.removeMember).toHaveBeenCalledTimes(1);
  expect(h.push).toHaveBeenCalledWith(expect.objectContaining({ label: "members.history.remove" }));
  expect(h.loadMembers).toHaveBeenCalledWith("t1");
});

test("single-member context menu assign unassigned role: assignMemberRole + push assignRole", async () => {
  await renderPage();
  // u2 lacks editor -> editor appears as an unassigned toggle under Roles
  fireEvent.click(screen.getByTestId("ctx-u2::members.roles::editor"));

  await waitFor(() => expect(h.push).toHaveBeenCalled());
  expect(h.assignMemberRole).toHaveBeenCalledWith("t1", "u2", "r-ed");
  expect(h.push).toHaveBeenCalledWith(expect.objectContaining({ label: "members.history.assignRole" }));
});

test("single-member context menu remove assigned role: removeMemberRole + push removeRole", async () => {
  await renderPage();
  // u1 has editor -> editor appears as an assigned toggle under Roles
  fireEvent.click(screen.getByTestId("ctx-u1::members.roles::editor"));

  await waitFor(() => expect(h.push).toHaveBeenCalled());
  expect(h.removeMemberRole).toHaveBeenCalledWith("t1", "u1", "r-ed");
  expect(h.push).toHaveBeenCalledWith(expect.objectContaining({ label: "members.history.removeRole" }));
});
