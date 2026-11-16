// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { MembersModel } from "@/components/members/useMembersModel";
import type { PendingInvitation } from "@/services/teamService";
import { makeMember, makeRole, makeTeam } from "@/test/team";

const h = vi.hoisted(() => ({
  model: null as unknown as MembersModel,
  revoke: vi.fn(),
  invite: vi.fn(),
  grant: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
vi.mock("@/utils/platform", async (orig) => ({
  ...(await orig<typeof import("@/utils/platform")>()),
  isMobileShell: () => true,
}));
vi.mock("@/components/members/useMembersModel", async (orig) => ({
  ...(await orig<typeof import("@/components/members/useMembersModel")>()),
  useMembersModel: () => h.model,
}));
vi.mock("@/hooks/usePermission", async () =>
  (await import("@/test/memberPermissions")).memberPermissions(() => PERM_BITS.ADMINISTRATOR | PERM_BITS.MANAGE_MEMBERS, { subject: "boss" }));
vi.mock("@/services/serverCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/services/serverCapabilities")>()),
  getServerCapability: (flag: string) => flag === "permissionPreview",
  useServerMultiOwner: () => false,
  useServerBillingEnabled: () => false,
}));
vi.mock("@/services/permissionPreview", () => ({ losesVaultKey: async () => false, holdsVaultKeyGate: async () => true }));
vi.mock("@/services/teamService", async (orig) => ({
  ...(await orig<typeof import("@/services/teamService")>()),
  getVaultKeyHolders: async () => ["boss"],
}));
vi.mock("@/services/account", () => ({ getMyHandle: async () => "zed" }));
vi.mock("@/services/vaultShare", () => ({ revokeInvitation: h.revoke, inviteByEmailAddress: h.invite, grantVaultKeyToMember: h.grant }));
vi.mock("@/components/members/cards/JoinRequests", () => ({ JoinRequestsSection: () => null }));
vi.mock("@/components/members/panels/RolesPanel", () => ({ RoleModal: () => null }));
vi.mock("@/components/members/OffboardingDialog", () => ({ OffboardingDialog: () => <div data-test-offboarding /> }));

import MobileMembersScreen from "./MobileMembersScreen";
import MobileMemberScreen from "./MobileMemberScreen";
import { PreviewContentScope } from "@/components/preview/PreviewScope";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useTeamStore } from "@/stores/teamStore";
import { PERM_BITS } from "@/services/permissions";
import { startPreview, stopPreview } from "@/test/preview";

const OWNER = makeRole("r-owner", 0, { name: "owner", is_builtin: true, position: 0 });
const MEMBER = makeRole("r-mem", PERM_BITS.CONNECT | PERM_BITS.VIEW, { name: "member", is_builtin: true, position: 1 });
const EDITOR = makeRole("r-ed", 0, { name: "editor", position: 2 });
const ROLES = [OWNER, MEMBER, EDITOR];
const BOSS = makeMember("boss", ["r-owner"], { handle: "zed", permission_allow: 0, permission_deny: 0 });
const ANA = makeMember("ana", ["r-mem"], { handle: "amber", public_key: "pk-ana", joined_at: "2024-03-04", permission_allow: 0, permission_deny: 0 });
const INV: PendingInvitation = {
  id: "inv1", display_name: "jade@example.com", role: "member", invited_by_display_name: null,
  created_at: "2024-01-01", expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), status: "pending",
};
const MODEL: MembersModel = {
  teamId: "t1", localVault: undefined, standaloneTeam: undefined,
  members: [BOSS, ANA], roles: ROLES, pending: [INV], loading: false,
  myUserId: "boss", myMember: BOSS,
  canManageMembers: true, canManageRoles: true, canInvite: true, canManageVault: true, canNameMembers: true,
  isOwnerMember: (m) => m.role_ids.includes("r-owner"),
  outOfReach: () => false,
  canActOn: (m) => m.user_id === "ana",
  canEditMember: () => true,
  visible: () => [BOSS, ANA],
  roleOptions: () => [EDITOR, MEMBER],
  changeRole: vi.fn(async () => {}),
  reload: vi.fn(async () => {}),
};

const LIST = { kind: "more-page" as const, page: "members" as const };
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const assignMemberRole = vi.fn(async () => {});
const removeMemberRole = vi.fn(async () => {});

async function expectRefused(name: string, sel: string) {
  useNotificationStore.setState({ toasts: [] });
  await act(async () => { fireEvent.click(q(sel)!); });
  await waitFor(() => expect(useNotificationStore.getState().toasts.map((x) => x.message), name).toEqual(["members.viewAs.readOnly"]));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.model = MODEL;
  useTeamStore.setState({
    teams: [makeTeam("t1", { owner_id: "boss" })],
    membersByTeam: { t1: [BOSS, ANA] },
    rolesByTeam: { t1: ROLES },
    assignMemberRole,
    removeMemberRole,
  });
  useMobileNavStore.setState({ stack: [LIST], sheet: null });
  startPreview();
});
afterEach(() => {
  cleanup();
  stopPreview();
});

describe("members_actions_refuse_while_previewing", () => {
  test("on the members list", async () => {
    render(<PreviewContentScope><MobileMembersScreen vaultId="t1" /></PreviewContentScope>);
    await expectRefused("invite", "[data-members-invite]");
    expect(useMobileNavStore.getState().stack).toEqual([LIST]);

    fireEvent.contextMenu(q("[data-mobile-member='ana'] button")!);
    for (const mode of ["assign", "remove"]) {
      await expectRefused(mode, `[data-members-sel-${mode}]`);
      expect(q("[data-role-pick]"), mode).toBeNull();
    }
    await expectRefused("kick", "[data-members-sel-kick]");
    expect(q("[data-test-offboarding]")).toBeNull();
    expect(MODEL.changeRole).not.toHaveBeenCalled();

    for (const action of ["resend", "revoke"]) {
      fireEvent.click(q("[data-mobile-invite='inv1'] button")!);
      await expectRefused(action, `[data-invite-action='${action}']`);
    }
    expect(h.invite).not.toHaveBeenCalled();
    expect(h.revoke).not.toHaveBeenCalled();
  });

  test("on the member screen", async () => {
    useMobileNavStore.setState({ stack: [LIST, { kind: "member", teamId: "t1", userId: "ana" }] });
    render(<PreviewContentScope><MobileMemberScreen teamId="t1" userId="ana" /></PreviewContentScope>);
    fireEvent.click(q("[data-member-roles] button")!);
    await expectRefused("role toggle", "[data-role-pick='r-ed']");
    expect(assignMemberRole).not.toHaveBeenCalled();
    expect(removeMemberRole).not.toHaveBeenCalled();

    await expectRefused("kick", "[data-member-remove]");
    expect(q("[data-test-offboarding]")).toBeNull();

    await waitFor(() => expect(q("[data-member-grant-key]")).not.toBeNull());
    await expectRefused("grant", "[data-member-grant-key]");
    expect(h.grant).not.toHaveBeenCalled();
  });
});
