import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { TeamMember, TeamRole } from "@/stores/teamStore";
import { PERM_BITS } from "@/services/permissions";

const h = vi.hoisted(() => ({
  assign: vi.fn(),
  remove: vi.fn(),
  removeMember: vi.fn(),
  addMemberById: vi.fn(),
  loadMembers: vi.fn(),
  push: vi.fn(),
  setPerms: vi.fn(),
  rotate: vi.fn(),
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
    membersByTeam: {} as Record<string, TeamMember[]>,
    assignMemberRole: h.assign,
    removeMemberRole: h.remove,
    removeMember: h.removeMember,
    addMemberById: h.addMemberById,
    loadMembers: h.loadMembers,
    setMemberPermissions: h.setPerms,
  };
  const useTeamStore = Object.assign(
    (sel: (s: typeof state) => unknown) => sel(state),
    { getState: () => state },
  );
  return { useTeamStore };
});
// teamOffboarding reads i18n directly rather than through react-i18next, so the
// label assertions below need the key back, not the English string.
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: Object.assign(
    (sel: (s: { push: typeof h.push }) => unknown) => sel({ push: h.push }),
    { getState: () => ({ push: h.push }) },
  ),
}));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/services/teamKeyRotation", () => ({
  checkAndRotateTeamKey: (...a: unknown[]) => h.rotate(...a),
}));

import { MemberDetailPanel } from "./panels/MemberDetailPanel";
import { useTeamStore } from "@/stores/teamStore";

const mockStore = useTeamStore.getState() as unknown as { membersByTeam: Record<string, TeamMember[]> };

const baseMember: TeamMember = {
  team_id: "t1",
  user_id: "u1",
  invited_by_display_name: null,
  joined_at: "2024-01-01T00:00:00Z",
  handle: "amber-lynx-4410",
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
  h.setPerms.mockResolvedValue(undefined);
  h.rotate.mockResolvedValue(undefined);
  mockStore.membersByTeam = {};
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

test("remove-member confirms in a dialog before removing", async () => {
  render(<MemberDetailPanel {...baseProps} />);
  fireEvent.click(screen.getByRole("button", { name: "members.removeFromTeam" }));
  expect(h.removeMember).not.toHaveBeenCalled();
  expect(await screen.findByText("members.offboarding.removeTitle")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "members.offboarding.removeConfirm" }));
  await waitFor(() => expect(baseProps.onUpdated).toHaveBeenCalled());
  expect(h.removeMember).toHaveBeenCalledWith("t1", "u1");
  expect(baseProps.onClose).toHaveBeenCalled();
  expect(h.push).toHaveBeenCalledWith(expect.objectContaining({ label: "members.history.remove" }));
});

test("cancelling the removal dialog removes nobody", async () => {
  render(<MemberDetailPanel {...baseProps} />);
  fireEvent.click(screen.getByRole("button", { name: "members.removeFromTeam" }));

  fireEvent.click(await screen.findByRole("button", { name: "settings.shared.cancel" }));

  expect(h.removeMember).not.toHaveBeenCalled();
  expect(h.push).not.toHaveBeenCalled();
});

test("offers Leave team to yourself instead of Remove", () => {
  render(<MemberDetailPanel {...baseProps} isMe member={{ ...baseMember, user_id: "me" }} />);

  expect(screen.getByRole("button", { name: "members.leaveTeam" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "members.removeFromTeam" })).toBeNull();
});

test("does not offer Leave team to the owner", () => {
  // The server rejects an owner removing themselves, so offering it would lie.
  render(
    <MemberDetailPanel {...baseProps} isMe isTargetOwner member={{ ...baseMember, user_id: "me" }} />,
  );

  expect(screen.queryByRole("button", { name: "members.leaveTeam" })).toBeNull();
});

test("remove undo closure: re-adds member, reassigns each snapshot role, reloads", async () => {
  render(<MemberDetailPanel {...baseProps} />);
  fireEvent.click(screen.getByRole("button", { name: "members.removeFromTeam" }));
  fireEvent.click(await screen.findByRole("button", { name: "members.offboarding.removeConfirm" }));
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

// ── Permission overrides ──────────────────────────────────────────────────

const viewerRole: TeamRole = {
  id: "r-viewer", team_id: "t1", name: "viewer-role", is_builtin: false,
  permissions: PERM_BITS.MANAGE_MEMBERS, position: 0, created_at: "",
};
const targetRole: TeamRole = {
  id: "r-target", team_id: "t1", name: "target-role", is_builtin: false,
  permissions: 0, position: 2, created_at: "",
};
const highRole: TeamRole = {
  id: "r-high", team_id: "t1", name: "high-role", is_builtin: false,
  permissions: 0, position: 0, created_at: "",
};

const viewerMember: TeamMember = {
  team_id: "t1", user_id: "uviewer", handle: "me", public_key: "k",
  invited_by_display_name: null, joined_at: "2024-01-01T00:00:00Z",
  role_ids: ["r-viewer"], permission_allow: 0, permission_deny: 0,
};

const targetMember: TeamMember = {
  team_id: "t1", user_id: "u2", handle: "alice", public_key: "k",
  invited_by_display_name: null, joined_at: "2024-01-01T00:00:00Z",
  role_ids: ["r-target"], permission_allow: 0, permission_deny: 0,
};

function permProps(overrides: Partial<{
  member: TeamMember; isMe: boolean; teamRoles: TeamRole[];
  canManageMembers: boolean; isTargetOwner: boolean; viewer: TeamMember;
  onUpdated: () => void;
}> = {}) {
  return {
    member: targetMember,
    isMe: false,
    teamId: "t1",
    teamRoles: [viewerRole, targetRole],
    canManageMembers: true,
    isTargetOwner: false,
    viewer: viewerMember,
    onClose: vi.fn(),
    onUpdated: vi.fn(),
    ...overrides,
  };
}

test("permission overrides: renders one row per permission and sends the new masks", async () => {
  render(<MemberDetailPanel {...permProps()} />);

  expect(screen.getAllByRole("radiogroup")).toHaveLength(16);

  const row = screen.getByRole("radiogroup", { name: "members.permission.EDIT_KEYS" });
  fireEvent.click(within(row).getByRole("radio", { name: /deny/i }));

  await waitFor(() =>
    expect(h.setPerms).toHaveBeenCalledWith("t1", "u2", 0, PERM_BITS.EDIT_KEYS),
  );

  mockStore.membersByTeam = { t1: [targetMember] };

  const entry = h.push.mock.calls[0][0] as { undo: () => Promise<void> };
  await entry.undo();
  expect(h.setPerms).toHaveBeenCalledWith("t1", "u2", 0, 0);
});

test("permission overrides: the filter narrows visible rows and hides empty groups", () => {
  render(<MemberDetailPanel {...permProps()} />);

  expect(screen.getAllByRole("radiogroup")).toHaveLength(16);

  fireEvent.change(screen.getByPlaceholderText("members.permissions.filterPlaceholder"), {
    target: { value: "secrets" },
  });

  const rows = screen.getAllByRole("radiogroup");
  expect(rows).toHaveLength(2);
  expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
    "members.permission.VIEW_SECRETS",
    "members.permission.COPY_SECRETS",
  ]);
  expect(screen.queryByText("members.permissions.group.sessions")).toBeNull();
});

test("permission overrides: a filter matching nothing shows the no-results copy", () => {
  render(<MemberDetailPanel {...permProps()} />);

  fireEvent.change(screen.getByPlaceholderText("members.permissions.filterPlaceholder"), {
    target: { value: "nothing-matches-this" },
  });

  expect(screen.queryAllByRole("radiogroup")).toHaveLength(0);
  expect(screen.getByText("common.state.noResults")).toBeTruthy();
});

test("permission overrides: undo throws instead of writing empty masks when the member is gone from the store", async () => {
  render(<MemberDetailPanel {...permProps()} />);

  const row = screen.getByRole("radiogroup", { name: "members.permission.EDIT_KEYS" });
  fireEvent.click(within(row).getByRole("radio", { name: /deny/i }));
  await waitFor(() =>
    expect(h.setPerms).toHaveBeenCalledWith("t1", "u2", 0, PERM_BITS.EDIT_KEYS),
  );

  const entry = h.push.mock.calls[0][0] as { undo: () => Promise<void> };
  expect(() => entry.undo()).toThrow();
});

// An older server omits both mask fields entirely; every row would otherwise
// render live and 404 on click.
test("no permissions section at all when the server serves neither mask", () => {
  const legacy = { ...targetMember };
  delete legacy.permission_allow;
  delete legacy.permission_deny;
  render(<MemberDetailPanel {...permProps({ member: legacy })} />);

  expect(screen.queryAllByRole("radiogroup")).toHaveLength(0);
  expect(screen.queryByText("members.permissions.title")).toBeNull();
});

test("undo re-reads the masks so a concurrent change survives the full replace", async () => {
  render(<MemberDetailPanel {...permProps()} />);

  const row = screen.getByRole("radiogroup", { name: "members.permission.EDIT_KEYS" });
  fireEvent.click(within(row).getByRole("radio", { name: /deny/i }));
  await waitFor(() =>
    expect(h.setPerms).toHaveBeenCalledWith("t1", "u2", 0, PERM_BITS.EDIT_KEYS),
  );

  mockStore.membersByTeam = {
    t1: [{ ...targetMember, permission_deny: PERM_BITS.EDIT_KEYS | PERM_BITS.CONNECT }],
  };

  const entry = h.push.mock.calls[0][0] as { undo: () => Promise<void> };
  await entry.undo();

  expect(h.setPerms).toHaveBeenLastCalledWith("t1", "u2", 0, PERM_BITS.CONNECT);
});

// CREATE_CUSTOM_ROLES is retired and normally hidden, but it is inside the
// server's ALL_PERMISSIONS, so a mask carrying it must stay clearable.
test("a retired bit set in a mask renders an enabled row that can clear it", async () => {
  const member = { ...targetMember, permission_allow: PERM_BITS.CREATE_CUSTOM_ROLES };
  render(<MemberDetailPanel {...permProps({ member })} />);

  expect(screen.getByText("members.permissions.readOnlyNotHeld")).toBeTruthy();
  const row = screen.getByRole("radiogroup", { name: "members.permission.CREATE_CUSTOM_ROLES" });
  expect((within(row).getByRole("radio", { name: /inherit/i }) as HTMLButtonElement).disabled).toBe(false);

  fireEvent.click(within(row).getByRole("radio", { name: /inherit/i }));

  await waitFor(() => expect(h.setPerms).toHaveBeenCalledWith("t1", "u2", 0, 0));
});

test("the retired bit renders no row when neither mask carries it", () => {
  render(<MemberDetailPanel {...permProps()} />);

  expect(screen.queryByRole("radiogroup", { name: "members.permission.CREATE_CUSTOM_ROLES" })).toBeNull();
});

test("a notHeld lock enables exactly the offending row, not the others", async () => {
  const member = { ...targetMember, permission_allow: PERM_BITS.CONNECT };
  render(<MemberDetailPanel {...permProps({ member })} />);

  const connectRow = screen.getByRole("radiogroup", { name: "members.permission.CONNECT" });
  expect((within(connectRow).getByRole("radio", { name: /allow/i }) as HTMLButtonElement).disabled).toBe(false);
  expect((within(connectRow).getByRole("radio", { name: /deny/i }) as HTMLButtonElement).disabled).toBe(false);

  const otherRow = screen.getByRole("radiogroup", { name: "members.permission.VIEW_SECRETS" });
  expect((within(otherRow).getByRole("radio", { name: /deny/i }) as HTMLButtonElement).disabled).toBe(true);

  fireEvent.click(within(connectRow).getByRole("radio", { name: /inherit/i }));

  // Clearing the member's only source of CONNECT crosses the vault key gate,
  // so this routes through the confirmation dialog before writing.
  fireEvent.click(await screen.findByRole("button", { name: "members.revokeKeyAccess.confirm" }));

  await waitFor(() =>
    expect(h.setPerms).toHaveBeenCalledWith("t1", "u2", 0, 0),
  );
});

test.each([
  {
    label: "no manage-members permission",
    key: "members.permissions.readOnlyNoManage",
    overrides: { canManageMembers: false },
  },
  {
    label: "target is an owner",
    key: "members.permissions.readOnlyOwner",
    overrides: { isTargetOwner: true },
  },
  {
    label: "target is the viewer themselves",
    key: "members.permissions.readOnlySelf",
    overrides: { isMe: true },
  },
  {
    label: "target holds a role at or above the viewer's",
    key: "members.permissions.readOnlyHigherRole",
    overrides: { member: { ...targetMember, role_ids: ["r-high"] }, teamRoles: [viewerRole, highRole] },
  },
  {
    label: "target already carries an allow bit the viewer lacks",
    key: "members.permissions.readOnlyNotHeld",
    overrides: { member: { ...targetMember, permission_allow: PERM_BITS.CONNECT } },
  },
])("read-only reason: $label", ({ overrides, key }) => {
  render(<MemberDetailPanel {...permProps(overrides)} />);

  expect(screen.getByText(key)).toBeTruthy();
  const row = screen.getByRole("radiogroup", { name: "members.permission.VIEW_SECRETS" });
  expect((within(row).getByRole("radio", { name: /deny/i }) as HTMLButtonElement).disabled).toBe(true);
});

test("hierarchy: a roleless target is not read-only", () => {
  render(<MemberDetailPanel {...permProps({ member: { ...targetMember, role_ids: [] } })} />);

  expect(screen.queryByText("members.permissions.readOnlyHigherRole")).toBeNull();
  const row = screen.getByRole("radiogroup", { name: "members.permission.VIEW_SECRETS" });
  expect((within(row).getByRole("radio", { name: /deny/i }) as HTMLButtonElement).disabled).toBe(false);
});

// The hierarchy check must fail CLOSED (read-only) when the viewer side of the
// comparison cannot be resolved at all, not just when it loses the comparison.
test.each([
  {
    label: "viewer is undefined",
    overrides: { viewer: undefined },
  },
  {
    label: "viewer holds no resolvable role",
    overrides: { viewer: { ...viewerMember, role_ids: [] } },
  },
])("hierarchy fails closed when $label", ({ overrides }) => {
  render(<MemberDetailPanel {...permProps(overrides)} />);

  expect(screen.getByText("members.permissions.readOnlyHigherRole")).toBeTruthy();
  const row = screen.getByRole("radiogroup", { name: "members.permission.VIEW_SECRETS" });
  expect((within(row).getByRole("radio", { name: /deny/i }) as HTMLButtonElement).disabled).toBe(true);
});

test("choosing allow on a bit the viewer lacks sends no request", async () => {
  render(<MemberDetailPanel {...permProps()} />);

  const row = screen.getByRole("radiogroup", { name: "members.permission.CONNECT" });
  fireEvent.click(within(row).getByRole("radio", { name: /allow/i }));

  expect(await screen.findByText("members.permissions.readOnlyNotHeld")).toBeTruthy();
  expect(h.setPerms).not.toHaveBeenCalled();
});

// ── Vault key gate confirmation ────────────────────────────────────────────

const keyRole: TeamRole = {
  id: "r-key", team_id: "t1", name: "key-role", is_builtin: false,
  permissions: PERM_BITS.VIEW_SECRETS, position: 2, created_at: "",
};
const keyMember: TeamMember = { ...targetMember, role_ids: ["r-key"] };

test("a gate-crossing change opens the dialog and writes nothing yet", async () => {
  render(<MemberDetailPanel {...permProps({ member: keyMember, teamRoles: [viewerRole, keyRole] })} />);

  const row = screen.getByRole("radiogroup", { name: "members.permission.VIEW_SECRETS" });
  fireEvent.click(within(row).getByRole("radio", { name: /deny/i }));

  expect(await screen.findByText("members.revokeKeyAccess.title")).toBeTruthy();
  expect(h.setPerms).not.toHaveBeenCalled();
});

test("every row is inert while the revoke dialog is open", async () => {
  render(<MemberDetailPanel {...permProps({ member: keyMember, teamRoles: [viewerRole, keyRole] })} />);

  const row = screen.getByRole("radiogroup", { name: "members.permission.VIEW_SECRETS" });
  fireEvent.click(within(row).getByRole("radio", { name: /deny/i }));
  await screen.findByText("members.revokeKeyAccess.title");

  const otherRow = screen.getByRole("radiogroup", { name: "members.permission.EDIT_KEYS" });
  expect((within(otherRow).getByRole("radio", { name: /deny/i }) as HTMLButtonElement).disabled).toBe(true);
});

test("confirming the dialog writes, then kicks rotation after the write resolves", async () => {
  let resolveSet: () => void = () => {};
  h.setPerms.mockImplementation(() => new Promise<void>((resolve) => { resolveSet = resolve; }));

  render(<MemberDetailPanel {...permProps({ member: keyMember, teamRoles: [viewerRole, keyRole] })} />);

  const row = screen.getByRole("radiogroup", { name: "members.permission.VIEW_SECRETS" });
  fireEvent.click(within(row).getByRole("radio", { name: /deny/i }));
  fireEvent.click(await screen.findByRole("button", { name: "members.revokeKeyAccess.confirm" }));

  await waitFor(() =>
    expect(h.setPerms).toHaveBeenCalledWith("t1", "u2", 0, PERM_BITS.VIEW_SECRETS),
  );
  expect(h.rotate).not.toHaveBeenCalled();

  resolveSet();
  await waitFor(() => expect(h.rotate).toHaveBeenCalledWith("t1"));
});

test("cancelling the dialog writes nothing and rotates nothing", async () => {
  render(<MemberDetailPanel {...permProps({ member: keyMember, teamRoles: [viewerRole, keyRole] })} />);

  const row = screen.getByRole("radiogroup", { name: "members.permission.VIEW_SECRETS" });
  fireEvent.click(within(row).getByRole("radio", { name: /deny/i }));
  fireEvent.click(await screen.findByRole("button", { name: "common.action.cancel" }));

  expect(screen.queryByText("members.revokeKeyAccess.title")).toBeNull();
  expect(h.setPerms).not.toHaveBeenCalled();
  expect(h.rotate).not.toHaveBeenCalled();
});

test("a non-crossing change writes immediately with no dialog and no rotation", async () => {
  render(<MemberDetailPanel {...permProps({ member: keyMember, teamRoles: [viewerRole, keyRole] })} />);

  const row = screen.getByRole("radiogroup", { name: "members.permission.EDIT_KEYS" });
  fireEvent.click(within(row).getByRole("radio", { name: /deny/i }));

  await waitFor(() =>
    expect(h.setPerms).toHaveBeenCalledWith("t1", "u2", 0, PERM_BITS.EDIT_KEYS),
  );
  expect(screen.queryByText("members.revokeKeyAccess.title")).toBeNull();
  expect(h.rotate).not.toHaveBeenCalled();
});

test("a rejected write after confirming does not rotate", async () => {
  h.setPerms.mockRejectedValueOnce(new Error("boom"));
  render(<MemberDetailPanel {...permProps({ member: keyMember, teamRoles: [viewerRole, keyRole] })} />);

  const row = screen.getByRole("radiogroup", { name: "members.permission.VIEW_SECRETS" });
  fireEvent.click(within(row).getByRole("radio", { name: /deny/i }));
  fireEvent.click(await screen.findByRole("button", { name: "members.revokeKeyAccess.confirm" }));

  expect(await screen.findByText("boom")).toBeTruthy();
  expect(h.rotate).not.toHaveBeenCalled();
});

test("clearing an allow grant crosses the gate too", async () => {
  const rolelessMember = {
    ...targetMember, role_ids: [], permission_allow: PERM_BITS.VIEW_SECRETS, permission_deny: 0,
  };
  render(<MemberDetailPanel {...permProps({ member: rolelessMember })} />);

  const row = screen.getByRole("radiogroup", { name: "members.permission.VIEW_SECRETS" });
  fireEvent.click(within(row).getByRole("radio", { name: /inherit/i }));

  expect(await screen.findByText("members.revokeKeyAccess.title")).toBeTruthy();
  expect(h.setPerms).not.toHaveBeenCalled();
});

test("a write in flight disables the other rows too", async () => {
  let resolveSet: () => void = () => {};
  h.setPerms.mockImplementation(() => new Promise<void>((resolve) => { resolveSet = resolve; }));

  render(<MemberDetailPanel {...permProps()} />);
  const row1 = screen.getByRole("radiogroup", { name: "members.permission.VIEW_SECRETS" });
  const row2 = screen.getByRole("radiogroup", { name: "members.permission.EDIT_KEYS" });

  fireEvent.click(within(row1).getByRole("radio", { name: /deny/i }));

  await waitFor(() =>
    expect((within(row2).getByRole("radio", { name: /deny/i }) as HTMLButtonElement).disabled).toBe(true),
  );

  resolveSet();
  await waitFor(() =>
    expect((within(row2).getByRole("radio", { name: /deny/i }) as HTMLButtonElement).disabled).toBe(false),
  );
});
