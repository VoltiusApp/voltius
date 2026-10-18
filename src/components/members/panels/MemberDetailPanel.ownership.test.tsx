import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { TeamMember, TeamRole } from "@/stores/teamStore";

const h = vi.hoisted(() => ({
  assign: vi.fn(),
  remove: vi.fn(),
  transfer: vi.fn(),
  caps: { multiOwner: true, billingEnabled: false },
  myUserId: "me",
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/shared/Panel", () => ({
  PanelShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelHeader: () => null,
  FormSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelHeaderIconButton: () => null,
}));
vi.mock("@/components/members/panels/RolesPanel", () => ({ RoleModal: () => null, TeamRolesPanel: () => null }));
vi.mock("@/stores/teamStore", () => {
  const state = {
    membersByTeam: {},
    teams: [{ id: "t", owner_id: "primary" }],
    assignMemberRole: h.assign,
    removeMemberRole: h.remove,
    transferBillingOwner: h.transfer,
  };
  const useTeamStore = Object.assign(
    (sel: (s: typeof state) => unknown) => sel(state),
    { getState: () => state },
  );
  return { useTeamStore };
});
vi.mock("@/services/serverCapabilities", () => ({
  useServerMultiOwner: () => h.caps.multiOwner,
  useServerBillingEnabled: () => h.caps.billingEnabled,
}));
vi.mock("@/hooks/useMyUserId", () => ({ useMyUserId: () => h.myUserId }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: Object.assign(
    (sel: (s: { push: () => void }) => unknown) => sel({ push: vi.fn() }),
    { getState: () => ({ push: vi.fn() }) },
  ),
}));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/services/teamKeyRotation", () => ({ checkAndRotateTeamKey: vi.fn() }));
vi.mock("@/hooks/useBusinessLock", () => ({ useBusinessLock: () => ({ locked: false, isOwner: false }) }));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn() }));

import { MemberDetailPanel } from "./MemberDetailPanel";

const role = (id: string, name: string, position: number): TeamRole =>
  ({ id, team_id: "t", name, permissions: 0, is_builtin: true, position, created_at: "" }) as TeamRole;
const teamRoles = [role("r-owner", "owner", 0), role("r-manager", "manager", 1)];
const person = (user_id: string, role_ids: string[]): TeamMember => ({
  team_id: "t", user_id, invited_by_display_name: null, joined_at: "2024-01-01T00:00:00Z",
  handle: user_id, public_key: "pk", role_ids,
});

function renderPanel(target: TeamMember, viewer: TeamMember, isMe = false) {
  return render(
    <MemberDetailPanel
      member={target}
      isMe={isMe}
      teamId="t"
      teamRoles={teamRoles}
      canManageMembers
      canNameMembers={false}
      isTargetOwner={target.role_ids.includes("r-owner")}
      viewer={viewer}
      onClose={vi.fn()}
      onUpdated={vi.fn()}
    />,
  );
}

const ownerViewer = person("me", ["r-owner"]);

beforeEach(() => {
  Object.assign(h.caps, { multiOwner: true, billingEnabled: false });
  h.myUserId = "me";
  for (const fn of [h.assign, h.remove, h.transfer]) fn.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

test("an Owner sees the Owner role and granting it asks for confirmation first", async () => {
  renderPanel(person("bob", ["r-manager"]), ownerViewer);
  fireEvent.click(screen.getByRole("button", { name: /members\.roleName\.owner/ }));
  expect(h.assign).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "members.ownership.grant.confirm" }));
  await waitFor(() => expect(h.assign).toHaveBeenCalledWith("t", "bob", "r-owner"));
});

test("a manager never sees the Owner role", () => {
  renderPanel(person("bob", ["r-manager"]), person("me", ["r-manager"]));
  expect(screen.queryByRole("button", { name: /members\.roleName\.owner/ })).toBeNull();
});

test("an old server hides the Owner role even from an Owner", () => {
  h.caps.multiOwner = false;
  renderPanel(person("bob", ["r-manager"]), ownerViewer);
  expect(screen.queryByRole("button", { name: /members\.roleName\.owner/ })).toBeNull();
});

test("the primary owner cannot be removed, and no transfer is offered on them", () => {
  renderPanel(person("primary", ["r-owner"]), ownerViewer);
  expect(screen.getByText("members.ownership.primary")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "members.removeFromTeam" })).toBeNull();
  expect(screen.queryByRole("button", { name: "members.ownership.makePrimary" })).toBeNull();
});

test("self-hosted, an Owner can make a co-owner primary after confirming", async () => {
  renderPanel(person("bob", ["r-owner"]), ownerViewer);
  expect(screen.getByRole("button", { name: "members.removeFromTeam" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "members.ownership.makePrimary" }));
  const buttons = await screen.findAllByRole("button", { name: "members.ownership.makePrimary" });
  fireEvent.click(buttons[buttons.length - 1]);
  await waitFor(() => expect(h.transfer).toHaveBeenCalledWith("t", "bob"));
});

test("on the cloud only the primary owner is offered the transfer", () => {
  h.caps.billingEnabled = true;
  renderPanel(person("bob", ["r-owner"]), ownerViewer);
  expect(screen.queryByRole("button", { name: "members.ownership.makePrimary" })).toBeNull();
  cleanup();
  h.myUserId = "primary";
  renderPanel(person("bob", ["r-owner"]), person("primary", ["r-owner"]));
  expect(screen.getByRole("button", { name: "members.ownership.makePrimary" })).toBeTruthy();
});

test("a co-owner can leave; the primary owner is told to hand over first", () => {
  renderPanel(person("me", ["r-owner"]), ownerViewer, true);
  expect(screen.getByRole("button", { name: "members.leaveTeam" })).toBeTruthy();
  cleanup();
  h.myUserId = "primary";
  renderPanel(person("primary", ["r-owner"]), person("primary", ["r-owner"]), true);
  expect(screen.queryByRole("button", { name: "members.leaveTeam" })).toBeNull();
  expect(screen.getByText("members.ownership.leaveBlocked")).toBeTruthy();
});
