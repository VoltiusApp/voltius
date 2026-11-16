import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { PreviewContentScope } from "@/hooks/previewScope";
import { stopPreview } from "@/test/preview";
import { PERM_BITS } from "@/services/permissions";

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
  menus: {} as Record<string, ContextMenuItem[]>,
  enter: vi.fn(),
  previewPermissions: vi.fn(),
  mobile: false,
  capable: true,
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
  PanelHeader: ({ title, actions }: { title?: string; actions?: React.ReactNode }) => <div data-testid="panel-title">{title}{actions}</div>,
  PanelHeaderIconButton: ({ icon, title, disabled, onClick }: { icon: string; title: string; disabled?: boolean; onClick: () => void }) => (
    <button data-testid={`header-${icon}`} title={title} disabled={disabled} onClick={onClick} />
  ),
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
      {it.onClick && (
        <button data-testid={`${prefix}::${it.label}`} disabled={!!it.disabledReason} title={it.disabledReason} onClick={() => it.onClick!()}>{it.label}</button>
      )}
      {it.children && renderMenu(it.children, `${prefix}::${it.label}`)}
    </span>
  ));
}
vi.mock("@/components/shared/BaseCard", () => ({
  BaseCard: (props: Record<string, unknown>) => {
    const id = props["data-selectable-id"] as string | undefined;
    h.menus[id ?? ""] = props.contextMenuItems as ContextMenuItem[];
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
  useOwnPermissions: () => (permission: string) => h.granted.has(permission),
  usePermissionSubjectId: () => h.subject,
}));
vi.mock("@/hooks/useMyUserId", () => ({ useMyUserId: () => "me" }));
vi.mock("@/utils/platform", async (orig) => ({ ...(await orig<typeof import("@/utils/platform")>()), isMobileShell: () => h.mobile }));
vi.mock("@/services/distribution", async (orig) => ({ ...(await orig<typeof import("@/services/distribution")>()), CAN_OPEN_CHECKOUT: true }));
vi.mock("@/services/permissionPreview", () => ({ previewPermissions: (...a: unknown[]) => h.previewPermissions(...a) }));
vi.mock("@/services/serverCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/services/serverCapabilities")>()),
  useServerPermissionPreview: () => h.capable,
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


import { usePreviewStore } from "@/stores/previewStore";
import { useTeamObjectAccessStore } from "@/stores/teamObjectAccessStore";

const originalEnter = usePreviewStore.getState().enter;
const ALL = ["MANAGE_MEMBERS", "MANAGE_ROLES", "INVITE_MEMBERS", "MANAGE_VAULT"];
const U1 = { type: "member", user_id: "u1" };
const FULL = { locked: false, draft: null, affected: null, current: { team_bits: 0, rule_sets: {}, holds_vault_key_gate: false, objects: {
  c1: { mask: PERM_BITS.VIEW, rule_set_id: null }, c2: { mask: PERM_BITS.VIEW, rule_set_id: null }, s1: { mask: 0, rule_set_id: null },
} } };
const access = (type: string) => ({ type, ruleSetId: null, myPermissions: 0, parentId: null, deleted: false });

beforeEach(() => {
  Object.values(h).forEach((v) => { if (typeof v === "function" && "mockReset" in v) (v as ReturnType<typeof vi.fn>).mockReset(); });
  h.loadTeams.mockResolvedValue(undefined);
  h.loadMembers.mockResolvedValue(undefined);
  h.loadRoles.mockResolvedValue(undefined);
  h.loadPendingInvitations.mockResolvedValue(undefined);
  h.previewPermissions.mockResolvedValue(FULL);
  h.granted = new Set(ALL);
  h.subject = "me";
  h.mobile = false;
  h.capable = true;
  h.teams[0].owner_tier = "business";
  h.teams[0].owner_id = "o";
  usePreviewStore.setState({ enter: h.enter });
  useTeamObjectAccessStore.getState().replaceTeam("t1", { c1: access("connection"), c2: access("connection"), s1: access("snippet") } as never, true);
});
afterEach(() => {
  cleanup();
  stopPreview();
  usePreviewStore.setState({ enter: originalEnter });
  useTeamObjectAccessStore.getState().clearAll();
});

async function renderPage() {
  render(<PreviewContentScope><MembersPage /></PreviewContentScope>);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

async function openDetail() {
  await renderPage();
  const open = screen.queryByTestId("ctx-u1::common.action.edit") ?? screen.getByTestId("ctx-u1::members.contextMenu.viewDetails");
  fireEvent.click(open);
  await act(async () => { await Promise.resolve(); });
}

test("context_menu_has_view_as_after_roles_with_divider_kept", async () => {
  await renderPage();
  const items = h.menus.u1;
  const labels = items.map((i) => i.label);
  expect(labels.slice(0, 3)).toEqual(["common.action.edit", "members.roles", "members.viewAs.menuItem"]);
  expect(items[1].divider).toBe(true);
  expect(items[2].divider).toBeFalsy();
  expect(items[2].disabledReason).toBeUndefined();
  fireEvent.click(screen.getByTestId("ctx-u1::members.viewAs.menuItem"));
  expect(h.enter).toHaveBeenCalledWith({ teamId: "t1", vaultId: "v1", subject: U1 });
});

test("context_menu_view_as_keeps_the_divider_after_open_without_a_roles_item", async () => {
  h.granted = new Set(["MANAGE_MEMBERS"]);
  h.teamRoles.length = 0;
  await renderPage();
  const items = h.menus.u1;
  expect(items[0].label).not.toBe("members.viewAs.menuItem");
  expect(items.findIndex((i) => i.label === "members.viewAs.menuItem")).toBeGreaterThan(0);
  expect(items[1].divider).toBe(true);
});

test("context_menu_view_as_is_greyed_with_its_reason", async () => {
  h.capable = false;
  await renderPage();
  const entry = screen.getByTestId("ctx-u1::members.viewAs.menuItem") as HTMLButtonElement;
  expect(entry.disabled).toBe(true);
  expect(entry.title).toBe("members.viewAs.reason.serverTooOld");
});

test("header_button_enters_preview", async () => {
  await openDetail();
  const button = screen.getByTestId("header-lucide:scan-eye") as HTMLButtonElement;
  expect(button.title).toBe("members.viewAs.viewAs");
  fireEvent.click(button);
  expect(h.enter).toHaveBeenCalledWith({ teamId: "t1", vaultId: "v1", subject: U1 });
});

test("summary_card_shows_counts_from_one_full_preview_and_enters_on_click", async () => {
  await openDetail();
  await waitFor(() => expect(screen.getByTestId("access-summary-card").textContent).toContain("members.viewAs.summary.counts"));
  expect(h.previewPermissions).toHaveBeenCalledTimes(1);
  expect(h.previewPermissions).toHaveBeenCalledWith("t1", { subject: U1, scope: "full" });
  fireEvent.click(screen.getByTestId("access-summary-card"));
  expect(h.enter).toHaveBeenCalledTimes(1);
});

test("summary_card_greyed_with_upsell_below_business_and_no_fetch", async () => {
  h.teams[0].owner_tier = "free";
  h.teams[0].owner_id = "me";
  await openDetail();
  const card = screen.getByTestId("access-summary-card") as HTMLButtonElement;
  expect(card.disabled).toBe(true);
  expect(card.title).toBe("members.viewAs.reason.needsBusiness");
  expect(screen.getByText("members.viewAs.reason.needsBusiness", { selector: "p" })).toBeTruthy();
  expect(screen.getByText("shared.businessLock.upgrade")).toBeTruthy();
  expect(h.previewPermissions).not.toHaveBeenCalled();
});

test("a_failed_fetch_shows_the_card_without_counts", async () => {
  h.previewPermissions.mockRejectedValue(new Error("boom"));
  await openDetail();
  await act(async () => { await Promise.resolve(); });
  const card = screen.getByTestId("access-summary-card");
  expect(card.textContent).toContain("members.viewAs.summary.title");
  expect(card.textContent).not.toContain("members.viewAs.summary.counts");
});

test("nothing_is_added_on_the_mobile_shell", async () => {
  h.mobile = true;
  await openDetail();
  expect(screen.queryByTestId("header-lucide:scan-eye")).toBeNull();
  expect(screen.queryByTestId("access-summary-card")).toBeNull();
  expect(screen.queryByTestId("ctx-u1::members.viewAs.menuItem")).toBeNull();
  expect(h.previewPermissions).not.toHaveBeenCalled();
});
