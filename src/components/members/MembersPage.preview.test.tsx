import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { PreviewContentScope } from "@/hooks/previewScope";
import { startPreview, stopPreview } from "@/test/preview";

const h = vi.hoisted(() => ({
  selector: <S extends object>(state: S) =>
    Object.assign((sel?: (s: S) => unknown) => (sel ? sel(state) : state), { getState: () => state }),
  loadTeams: vi.fn(),
  loadMembers: vi.fn(),
  loadRoles: vi.fn(),
  loadPendingInvitations: vi.fn(),
  assignMemberRole: vi.fn(),
  removeMemberRole: vi.fn(),
  removeMember: vi.fn(),
  push: vi.fn(),
  toast: vi.fn(),
  granted: new Set<string>(),
  subject: "me",
  teams: [{ id: "t1", name: "T", owner_id: "o", owner_tier: "business", created_at: "", role_ids: [] }],
  teamRoles: [
    { id: "r-owner", team_id: "t1", name: "owner", is_builtin: true, permissions: 0, position: 0, created_at: "" },
    { id: "r-mem", team_id: "t1", name: "member", is_builtin: true, permissions: 0, position: 1, created_at: "" },
    { id: "r-ed", team_id: "t1", name: "editor", is_builtin: false, permissions: 0, position: 2, created_at: "" },
  ],
  members: [
    { team_id: "t1", user_id: "me", invited_by_display_name: null, joined_at: "2024-01-01T00:00:00Z", handle: "merry-quartz-2597", public_key: "pk", role_ids: ["r-mem"] },
    { team_id: "t1", user_id: "u1", invited_by_display_name: null, joined_at: "2024-01-02T00:00:00Z", handle: "amber-lynx-4410", public_key: "pk", role_ids: ["r-mem"] },
  ],
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/members/cards/JoinRequests", () => ({ JoinRequestsSection: () => null }));
vi.mock("@/components/shared/StatusDot", () => ({ StatusDot: () => null }));
vi.mock("@/components/shared/Panel", () => ({
  PanelShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelHeader: ({ title }: { title?: string }) => <div data-testid="panel-title">{title}</div>,
  PanelHeaderIconButton: () => null,
  FormSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/SidePanelLayout", () => ({
  SidePanelLayout: ({ panel, children }: { panel: React.ReactNode; children: React.ReactNode }) => <div>{panel}{children}</div>,
}));
vi.mock("@/components/shared/DragSelectSurface", () => ({
  DragSelectSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/shared/ToolbarViewControls", () => ({ ToolbarViewControls: () => null }));

function renderMenu(items: ContextMenuItem[] | undefined, prefix: string): React.ReactNode {
  if (!items) return null;
  return items.map((it, i) => (
    <span key={`${prefix}::${it.label}::${i}`}>
      {it.onClick && <button data-testid={`${prefix}::${it.label}`} onClick={() => it.onClick!()}>{it.label}</button>}
      {it.children && renderMenu(it.children, `${prefix}::${it.label}`)}
    </span>
  ));
}
vi.mock("@/components/shared/BaseCard", () => ({
  BaseCard: (props: Record<string, unknown>) => {
    const id = props["data-selectable-id"] as string | undefined;
    return (
      <div>
        <div data-testid={`body-${id}`}>{props.children as React.ReactNode}</div>
        {renderMenu(props.contextMenuItems as ContextMenuItem[] | undefined, `ctx-${id}`)}
      </div>
    );
  },
}));

vi.mock("@/components/settings/BuySeatsModal", () => ({ default: () => null }));
vi.mock("@/components/members/panels/RolesPanel", () => ({ RoleModal: () => null, PERM_META: {}, TeamRolesPanel: () => null }));
vi.mock("@/components/members/panels/InvitePanel", () => ({ InvitePanel: () => <div data-testid="invite-panel" /> }));
vi.mock("@/hooks/useListKeyNav", () => ({ useListKeyNav: () => ({ focusedId: null, setFocusedId: () => {} }) }));
vi.mock("@/hooks/usePermission", async (orig) => ({
  ...(await orig<typeof import("@/hooks/usePermission")>()),
  usePermissions: () => (permission: string) => h.granted.has(permission),
  usePermissionSubjectId: () => h.subject,
}));
vi.mock("@/services/appToast", () => ({ appToast: (...a: unknown[]) => h.toast(...a) }));
vi.mock("@/services/account", () => ({ getMyHandle: async () => "merry-quartz-2597" }));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn() }));
vi.mock("@/stores/teamVaultStateStore", () => ({ useTeamVaultStateStore: { getState: () => ({}) } }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

vi.mock("@/stores/vaultStore", () => ({
  useVaultStore: h.selector({ selectedVaultIds: ["v1"], vaults: [{ id: "v1", name: "V", teamId: "t1" }], setVaultTeamId: vi.fn() }),
}));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: h.selector({
    teams: h.teams,
    loadTeams: h.loadTeams,
    membersByTeam: { t1: h.members },
    loadMembers: h.loadMembers,
    rolesByTeam: { t1: h.teamRoles },
    loadRoles: h.loadRoles,
    pendingInvitationsByTeam: {},
    loadPendingInvitations: h.loadPendingInvitations,
    assignMemberRole: h.assignMemberRole,
    removeMemberRole: h.removeMemberRole,
    removeMember: h.removeMember,
  }),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: h.selector({ isTeams: true, ownsTeamsPlan: true, accountMode: "server", usedSeats: 1, totalSeats: 5, load: vi.fn() }),
}));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: h.selector({
    membersLayoutMode: "list",
    membersSortMode: "name-asc",
    setMembersLayoutMode: vi.fn(),
    setMembersSortMode: vi.fn(),
    membersPanelPending: null,
    clearMembersPanelPending: vi.fn(),
    openSettings: vi.fn(),
    openCloudAuth: vi.fn(),
  }),
}));
vi.mock("@/stores/teamSessionStore", () => ({
  useTeamSessionStore: h.selector({ activeSessions: [], connections: {}, inviteToActiveSession: vi.fn() }),
}));
vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: Object.assign(
    (sel: (s: { push: typeof h.push }) => unknown) => sel({ push: h.push }),
    { getState: () => ({ push: h.push }) },
  ),
}));

import MembersPage from "./MembersPage";

const ALL = ["MANAGE_MEMBERS", "MANAGE_ROLES", "INVITE_MEMBERS", "MANAGE_VAULT"];

beforeEach(() => {
  Object.values(h).forEach((v) => { if (typeof v === "function" && "mockReset" in v) (v as ReturnType<typeof vi.fn>).mockReset(); });
  h.loadTeams.mockResolvedValue(undefined);
  h.loadMembers.mockResolvedValue(undefined);
  h.loadRoles.mockResolvedValue(undefined);
  h.loadPendingInvitations.mockResolvedValue(undefined);
  h.assignMemberRole.mockResolvedValue(undefined);
  h.removeMemberRole.mockResolvedValue(undefined);
  h.removeMember.mockResolvedValue(undefined);
  h.granted = new Set();
  h.subject = "me";
});
afterEach(() => { cleanup(); stopPreview(); });

async function renderPage() {
  render(<PreviewContentScope><MembersPage /></PreviewContentScope>);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

const toolbarButton = (label: string) => screen.queryByText(label)?.closest("button") ?? null;

test("members_page_shows_the_subject_as_you_and_hides_manage_controls_greyed", async () => {
  h.subject = "u1";
  startPreview();
  await renderPage();

  expect(screen.getByTestId("body-u1").textContent).toContain("members.youBadge");
  expect(screen.getByTestId("body-me").textContent).not.toContain("members.youBadge");
  for (const label of ["members.toolbar.inviteBtn", "members.roles", "members.security.button"]) {
    const button = toolbarButton(label);
    expect(button, label).not.toBeNull();
    expect(button!.disabled, label).toBe(true);
    expect(button!.title, label).toBe("members.viewAs.lacksPermission");
  }
});

test("members_area_write_controls_refuse_while_previewing", async () => {
  h.granted = new Set(ALL);
  startPreview();
  await renderPage();

  fireEvent.click(screen.getByTestId("ctx-u1::members.kick"));
  fireEvent.click(screen.getByTestId("ctx-u1::members.roles::members.roleName.editor"));
  fireEvent.click(toolbarButton("members.toolbar.inviteBtn")!);

  await waitFor(() => expect(h.toast).toHaveBeenCalledTimes(3));
  expect(h.toast).toHaveBeenCalledWith("info", "members.viewAs.readOnly");
  expect(screen.queryByText("members.offboarding.removeTitle")).toBeNull();
  expect(screen.queryByTestId("invite-panel")).toBeNull();
  expect(h.assignMemberRole).not.toHaveBeenCalled();
  expect(h.removeMember).not.toHaveBeenCalled();
});

test("pages_unchanged_outside_preview", async () => {
  const gates = () => ({
    invite: !!toolbarButton("members.toolbar.inviteBtn"),
    roles: !!toolbarButton("members.roles"),
    security: !!toolbarButton("members.security.button"),
    kick: !!screen.queryByTestId("ctx-u1::members.kick"),
  });

  await renderPage();
  expect(gates()).toEqual({ invite: false, roles: false, security: false, kick: false });
  cleanup();

  h.granted = new Set(ALL);
  await renderPage();
  expect(gates()).toEqual({ invite: true, roles: true, security: true, kick: true });
  expect(toolbarButton("members.toolbar.inviteBtn")!.disabled).toBe(false);

  fireEvent.click(screen.getByTestId("ctx-u1::members.roles::members.roleName.editor"));
  await waitFor(() => expect(h.assignMemberRole).toHaveBeenCalledWith("t1", "u1", "r-ed"));
  expect(h.toast).not.toHaveBeenCalled();
});
