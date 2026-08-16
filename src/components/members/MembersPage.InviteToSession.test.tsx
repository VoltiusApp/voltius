import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";

const h = vi.hoisted(() => ({
  getMyUserId: vi.fn(),
  getMyHandle: vi.fn(),
  loadTeams: vi.fn(),
  loadMembers: vi.fn(),
  loadRoles: vi.fn(),
  loadPendingInvitations: vi.fn(),
  startSharing: vi.fn(),
  inviteToActiveSession: vi.fn(),
  addToast: vi.fn(),
  updateToast: vi.fn(),
  teamRoles: [
    { id: "r-owner", team_id: "t1", name: "owner", is_builtin: true, permissions: 0, position: 0, created_at: "" },
    { id: "r-mem", team_id: "t1", name: "member", is_builtin: true, permissions: 0, position: 1, created_at: "" },
  ],
  members: [
    { team_id: "t1", user_id: "me", invited_by_display_name: null, joined_at: "2024-01-01T00:00:00Z", handle: "merry-quartz-2597", public_key: "pk", role_ids: ["r-mem"] },
    { team_id: "t1", user_id: "u1", invited_by_display_name: null, joined_at: "2024-01-02T00:00:00Z", handle: "amber-lynx-4410", public_key: "pk", role_ids: ["r-mem"] },
    { team_id: "t1", user_id: "u2", invited_by_display_name: null, joined_at: "2024-01-03T00:00:00Z", handle: "brisk-otter-8823", public_key: "pk", role_ids: ["r-mem"] },
  ],
  // one hosted session with the key retained (invitable), one hosted with no key,
  // one guest session, and one active-on-the-server session hosted elsewhere.
  connections: {
    "local-1": { multiplayerSessionId: "mp-1", role: "host", sessionKeyBytes: new Uint8Array([1]) },
    "local-2": { multiplayerSessionId: "mp-2", role: "host" }, // key not retained -> not invitable
    "local-3": { multiplayerSessionId: "mp-3", role: "guest", sessionKeyBytes: new Uint8Array([1]) },
  },
  activeSessions: [
    { id: "mp-1", connection_name: "prod-box", host_user_id: "me", host_public_key: "pk", visibility: "vault", created_at: "", participant_count: 1 },
    { id: "mp-2", connection_name: "staging-box", host_user_id: "me", host_public_key: "pk", visibility: "vault", created_at: "", participant_count: 1 },
    { id: "mp-4", connection_name: "other-device-box", host_user_id: "someone-else", host_public_key: "pk", visibility: "vault", created_at: "", participant_count: 1 },
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

// Flattens context-menu items into clickable leaf buttons so their handlers
// can be invoked directly, mirroring MembersPage.BulkActions.test.tsx.
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
        <button data-testid={`card-${id}`} onClick={props.onClick as React.MouseEventHandler}>
          {id}
        </button>
        {renderMenu(props.contextMenuItems as ContextMenuItem[] | undefined, `ctx-${id}`)}
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
  inviteByEmail: vi.fn(),
  revokePendingInvitation: vi.fn(),
}));
vi.mock("@/services/account", () => ({ getMyHandle: h.getMyHandle }));
vi.mock("@/services/teamVaultActivation", () => ({ markTeamVaultLoadedAfterLocalActivation: vi.fn() }));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn() }));
vi.mock("@/services/teamVaultSync", () => ({ initTeamVaultKey: vi.fn() }));
vi.mock("@/stores/teamVaultStateStore", () => ({ useTeamVaultStateStore: { getState: () => ({}) } }));

// Real runTeamAction + a stubbed notification store: exercises the actual
// toast/error affordance instead of a passthrough mock, so a rejected
// invite failing to surface an error is a real regression, not a vacuous one.
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: { getState: () => ({ addToast: h.addToast, updateToast: h.updateToast }) },
}));

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
    addMemberById: vi.fn(),
    assignMemberRole: vi.fn(),
    removeMemberRole: vi.fn(),
    removeMember: vi.fn(),
  };
  const useTeamStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  );
  return { useTeamStore };
});
vi.mock("@/stores/subscriptionStore", () => {
  // Pro: guest cap 1, the tier the cap guard has to hold for.
  const state = { tier: "pro", isTeams: true, accountMode: "server", usedSeats: 1, totalSeats: 5, load: vi.fn() };
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
  const state = {
    activeSessions: h.activeSessions,
    connections: h.connections,
    startSharing: h.startSharing,
    inviteToActiveSession: h.inviteToActiveSession,
  };
  const useTeamSessionStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  );
  return { useTeamSessionStore };
});
vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: (sel: (s: { push: (e: unknown) => void }) => unknown) => sel({ push: vi.fn() }),
}));

import MembersPage from "./MembersPage";

// The store mocks capture `h.connections` / `h.activeSessions` by reference at
// module-factory time, so fixtures have to be edited in place, never reassigned.
function patchConnection(localSessionId: string, patch: Record<string, unknown>) {
  Object.assign((h.connections as Record<string, Record<string, unknown>>)[localSessionId], patch);
}
function patchActiveSession(id: string, patch: Record<string, unknown>) {
  Object.assign((h.activeSessions as Record<string, unknown>[]).find((s) => s.id === id)!, patch);
}
const pristine = structuredClone({ connections: h.connections, activeSessions: h.activeSessions });
function resetFixtures() {
  const fresh = structuredClone(pristine);
  Object.keys(h.connections).forEach((k) => { delete (h.connections as Record<string, unknown>)[k]; });
  Object.assign(h.connections, fresh.connections);
  // sessionKeyBytes is what marks a session invitable; structuredClone keeps the
  // Uint8Array, but restore explicitly so the intent survives a fixture edit.
  patchConnection("local-1", { sessionKeyBytes: new Uint8Array([1]) });
  patchConnection("local-3", { sessionKeyBytes: new Uint8Array([1]) });
  (h.activeSessions as unknown[]).splice(0, h.activeSessions.length, ...fresh.activeSessions);
}

beforeEach(() => {
  resetFixtures();
  Object.values(h).forEach((v) => { if (typeof v === "function" && "mockReset" in v) (v as ReturnType<typeof vi.fn>).mockReset(); });
  h.getMyUserId.mockResolvedValue("me");
  h.getMyHandle.mockResolvedValue("merry-quartz-2597");
  h.loadTeams.mockResolvedValue(undefined);
  h.loadMembers.mockResolvedValue(undefined);
  h.loadRoles.mockResolvedValue(undefined);
  h.loadPendingInvitations.mockResolvedValue(undefined);
  h.inviteToActiveSession.mockResolvedValue(undefined);
  h.addToast.mockReturnValue("toast-1");
});
afterEach(() => cleanup());

async function renderPage() {
  render(<MembersPage />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

test("invite-to-session menu lists only locally-hosted sessions with a retained key", async () => {
  await renderPage();
  // mp-1: hosted here, key retained -> listed under its connection_name
  expect(screen.getByTestId("ctx-u1::members.contextMenu.inviteToSession::prod-box")).toBeTruthy();
  // mp-2: hosted here, but no sessionKeyBytes -> not listed
  expect(screen.queryByTestId("ctx-u1::members.contextMenu.inviteToSession::staging-box")).toBeNull();
  // mp-4: active on the server but hosted on another device -> not listed
  expect(screen.queryByTestId("ctx-u1::members.contextMenu.inviteToSession::other-device-box")).toBeNull();
  // guest connection (local-3) never appears regardless of activeSessions
  expect(screen.queryAllByTestId(/other-device-box/).length).toBe(0);
});

test("clicking a hosted-session entry calls inviteToActiveSession with the local id and member, not startSharing", async () => {
  await renderPage();
  fireEvent.click(screen.getByTestId("ctx-u1::members.contextMenu.inviteToSession::prod-box"));

  await waitFor(() => expect(h.inviteToActiveSession).toHaveBeenCalled());
  expect(h.inviteToActiveSession).toHaveBeenCalledWith(
    "local-1",
    expect.objectContaining({ user_id: "u1" }),
  );
  expect(h.startSharing).not.toHaveBeenCalled();
});

test("a rejected invite surfaces an error toast rather than being swallowed", async () => {
  h.inviteToActiveSession.mockRejectedValue(new Error("common.error.cannotInviteWithoutSessionKey"));
  await renderPage();
  fireEvent.click(screen.getByTestId("ctx-u1::members.contextMenu.inviteToSession::prod-box"));

  await waitFor(() => expect(h.updateToast).toHaveBeenCalled());
  const [, patch] = h.updateToast.mock.calls[0] as [string, { severity?: string; message?: string }];
  expect(patch.severity).toBe("error");
});

test("with no locally-hosted invitable sessions, the noActiveSessions entry still renders", async () => {
  Object.keys(h.connections).forEach((k) => { delete (h.connections as Record<string, unknown>)[k]; });
  await renderPage();
  expect(screen.getByTestId("ctx-u1::members.contextMenu.inviteToSession::members.contextMenu.noActiveSessions")).toBeTruthy();
});

// ─── Same guards the ShareMenu roster has (#66 follow-up) ─────────────────────

const INVITE_PROD = "members.contextMenu.inviteToSession::prod-box";

test("a session that has already spent its guest cap is not offered", async () => {
  // Pro host, cap 1, one guest already live -> no seat left for anyone.
  patchConnection("local-1", {
    myUserId: "me",
    participants: [{ user_id: "me", handle: "merry-quartz-2597" }, { user_id: "guest-1", handle: "guest-fox-1207" }],
  });
  await renderPage();
  expect(screen.queryByTestId(`ctx-u1::${INVITE_PROD}`)).toBeNull();
  expect(screen.getByTestId("ctx-u1::members.contextMenu.inviteToSession::members.contextMenu.noInvitableSessions")).toBeTruthy();
});

test("a member who already holds a standing invite is not offered that session", async () => {
  patchActiveSession("mp-1", { invitee_ids: ["u1"] });
  await renderPage();
  expect(screen.queryByTestId(`ctx-u1::${INVITE_PROD}`)).toBeNull();
  // The seat is spent by u1's invite, so at cap 1 nobody else is offered it either.
  expect(screen.queryByTestId(`ctx-u2::${INVITE_PROD}`)).toBeNull();
});

test("a member already live in the session is not offered it, while others still are", async () => {
  patchConnection("local-1", { myUserId: "me", participants: [{ user_id: "u1", handle: "amber-lynx-4410" }] });
  patchActiveSession("mp-1", { vault_ids: [] });
  // Cap 1 spent by u1 being live; raise the cap via the session's vault-owner tier
  // so this test isolates the dedupe guard from the cap guard.
  patchConnection("local-1", { vaultOwnerTier: "teams" });
  await renderPage();
  expect(screen.queryByTestId(`ctx-u1::${INVITE_PROD}`)).toBeNull();
  expect(screen.getByTestId(`ctx-u2::${INVITE_PROD}`)).toBeTruthy();
});

test("the invite-to-session action is not offered for yourself", async () => {
  await renderPage();
  expect(screen.getByTestId(`ctx-u1::${INVITE_PROD}`)).toBeTruthy();
  expect(screen.queryByTestId(`ctx-me::${INVITE_PROD}`)).toBeNull();
  expect(screen.queryByTestId("ctx-me::members.contextMenu.inviteToSession::members.contextMenu.noInvitableSessions")).toBeNull();
});
