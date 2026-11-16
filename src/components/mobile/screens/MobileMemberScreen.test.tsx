// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MembersModel } from "@/components/members/useMembersModel";
import type { TeamMember } from "@/stores/teamStore";
import { makeMember, makeRole, makeTeam } from "@/test/team";

const h = vi.hoisted(() => ({
  model: null as unknown as MembersModel,
  bits: 0,
  losesVaultKey: vi.fn(async () => false),
  holders: vi.fn(async () => ["boss"]),
  grant: vi.fn(async () => {}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/members/useMembersModel", () => ({ useMembersModel: () => h.model }));
vi.mock("@/hooks/usePermission", async () =>
  (await import("@/test/memberPermissions")).memberPermissions(() => h.bits, { subject: "boss" }));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/services/serverCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/services/serverCapabilities")>()),
  getServerCapability: (flag: string) => flag === "permissionPreview",
  useServerMultiOwner: () => false,
  useServerBillingEnabled: () => false,
}));
vi.mock("@/services/permissionPreview", () => ({ losesVaultKey: h.losesVaultKey }));
vi.mock("@/services/vaultKeyActions", () => ({ rotateTeamKeyNow: vi.fn(async () => ({})) }));
vi.mock("@/services/teamService", async (orig) => ({
  ...(await orig<typeof import("@/services/teamService")>()),
  getVaultKeyHolders: h.holders,
}));
vi.mock("@/services/vaultShare", () => ({ grantVaultKeyToMember: h.grant }));
vi.mock("@/components/members/panels/RolesPanel", () => ({ RoleModal: () => null }));
vi.mock("@/components/members/OffboardingDialog", () => ({
  OffboardingDialog: ({ members, onDone }: { members: TeamMember[]; onDone: () => void }) => (
    <button data-test-offboarding={members.map((m) => m.user_id).join(",")} onClick={onDone} />
  ),
}));

import MobileMemberScreen from "./MobileMemberScreen";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useTeamStore } from "@/stores/teamStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { PERM_BITS } from "@/services/permissions";

const OWNER = makeRole("r-owner", 0, { name: "owner", is_builtin: true, position: 0 });
const MEMBER = makeRole("r-mem", PERM_BITS.CONNECT | PERM_BITS.VIEW, { name: "member", is_builtin: true, position: 1 });
const EDITOR = makeRole("r-ed", 0, { name: "editor", position: 2 });
const ROLES = [OWNER, MEMBER, EDITOR];
const BOSS = makeMember("boss", ["r-owner"], { handle: "zed", permission_allow: 0, permission_deny: 0 });
const ANA = makeMember("ana", ["r-mem"], {
  handle: "amber", member_name: "Ana", public_key: "pk-ana", joined_at: "2024-03-04",
  invited_by_display_name: "zed", permission_allow: 0, permission_deny: 0,
});

const assignMemberRole = vi.fn(async () => {});
const removeMemberRole = vi.fn(async () => {});

function makeModel(over: Partial<MembersModel> = {}): MembersModel {
  const members = over.members ?? [BOSS, ANA];
  return {
    teamId: "t1", localVault: undefined, standaloneTeam: undefined,
    members, roles: ROLES, pending: [], loading: false,
    myUserId: "boss", myMember: BOSS,
    canManageMembers: true, canManageRoles: true, canInvite: true, canManageVault: true, canNameMembers: true,
    isOwnerMember: (m) => m.role_ids.includes("r-owner"),
    outOfReach: () => false,
    canActOn: (m) => m.user_id !== "boss",
    canEditMember: () => true,
    visible: () => members,
    roleOptions: () => ROLES,
    changeRole: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    ...over,
  };
}

const LIST = { kind: "more-page" as const, page: "members" as const };
const SELF = { kind: "member" as const, teamId: "t1", userId: "ana" };
const q = (sel: string) => document.querySelector<HTMLElement>(sel);
const renderScreen = () => render(<MobileMemberScreen teamId="t1" userId="ana" />);
const keyRow = () => waitFor(() => { const row = q("[data-member-vault-key]"); expect(row).not.toBeNull(); return row!; });

beforeEach(() => {
  vi.clearAllMocks();
  h.model = makeModel();
  h.bits = PERM_BITS.ADMINISTRATOR | PERM_BITS.MANAGE_MEMBERS | PERM_BITS.CONNECT | PERM_BITS.VIEW;
  h.losesVaultKey.mockResolvedValue(false);
  h.holders.mockResolvedValue(["boss"]);
  useTeamStore.setState({
    teams: [makeTeam("t1", { owner_id: "boss" })],
    membersByTeam: { t1: [BOSS, ANA] },
    rolesByTeam: { t1: ROLES },
    assignMemberRole,
    removeMemberRole,
  });
  useMobileNavStore.setState({ stack: [LIST, SELF], sheet: null });
  useNotificationStore.setState({ toasts: [] });
});
afterEach(cleanup);

describe("MobileMemberScreen", () => {
  test("shows_name_roles_permissions_key_info_and_danger_in_order", async () => {
    renderScreen();
    await keyRow();
    expect(q("[data-mobile-back]")).not.toBeNull();
    expect(q("[data-vt-hit-scope]")).not.toBeNull();
    expect(screen.getByText("Ana")).toBeTruthy();
    expect(screen.getByText("@amber")).toBeTruthy();
    const order = [...document.querySelectorAll("[data-member-section], [data-member-vault-key]")]
      .map((e) => e.getAttribute("data-member-section") ?? "key");
    expect(order).toEqual(["name", "roles", "permissions", "info", "key", "danger"]);
    expect(q("[data-member-section='info']")!.textContent).toContain("members.memberSince");
    expect(q("[data-member-section='info']")!.textContent).toContain("members.invitedBy");
    expect(q("[data-member-section='permissions'] [role=radio]")!.className).toContain("w-11 h-10");
    expect(q("[data-member-remove]")!.textContent).toContain("members.removeFromTeam");
  });

  test("role_picker_toggle_calls_model_toggle", async () => {
    renderScreen();
    fireEvent.click(q("[data-member-roles] button")!);
    const editor = q("[data-role-pick='r-ed']")!;
    expect(editor.getAttribute("aria-checked")).toBe("false");
    expect(q("[data-role-pick='r-mem']")!.getAttribute("aria-checked")).toBe("true");
    expect(q("[data-role-pick='r-owner']")).toBeNull();
    await act(async () => { fireEvent.click(editor); });
    expect(assignMemberRole).toHaveBeenCalledWith("t1", "ana", "r-ed");
    expect(q("[data-role-pick='r-ed']")).not.toBeNull();
  });

  test("read_only_roles_row_shows_the_reason_and_every_role_is_disabled", () => {
    h.model = makeModel({ canManageMembers: false });
    h.bits = PERM_BITS.CONNECT;
    renderScreen();
    expect(q("[data-member-roles]")!.textContent).toContain("members.permissions.readOnlyNoManage");
    fireEvent.click(q("[data-member-roles] button")!);
    const picks = [...document.querySelectorAll<HTMLButtonElement>("[data-role-pick]")];
    expect(picks.length).toBeGreaterThan(0);
    expect(picks.every((b) => b.disabled)).toBe(true);
  });

  test("toggling_off_the_last_connect_role_asks_before_revoking_the_key", async () => {
    h.losesVaultKey.mockResolvedValue(true);
    renderScreen();
    fireEvent.click(q("[data-member-roles] button")!);
    await act(async () => { fireEvent.click(q("[data-role-pick='r-mem']")!); });
    expect(h.losesVaultKey).toHaveBeenCalledWith("t1", "ana", { role_ids: [], allow: 0, deny: 0 });
    expect(screen.getByText("members.revokeKeyAccess.title")).toBeTruthy();
    expect(removeMemberRole).not.toHaveBeenCalled();
  });

  test("awaiting_key_shows_grant_and_grant_calls_the_service", async () => {
    renderScreen();
    const row = await keyRow();
    expect(row.textContent).toContain("mobile.members.keyAwaiting");
    h.holders.mockResolvedValue(["boss", "ana"]);
    await act(async () => { fireEvent.click(q("[data-member-grant-key]")!); });
    expect(h.grant).toHaveBeenCalledWith({ teamId: "t1", userId: "ana", label: "Ana", publicKey: "pk-ana" });
    await waitFor(() => expect(q("[data-member-vault-key]")!.textContent).toContain("mobile.members.keyHeld"));
    expect(q("[data-member-grant-key]")).toBeNull();
  });

  test("grant_greyed_without_manage_members", async () => {
    h.model = makeModel({ canManageMembers: false });
    renderScreen();
    const row = await keyRow();
    const grant = q("[data-member-grant-key]")!;
    expect(grant.getAttribute("aria-disabled")).toBe("true");
    expect(row.textContent).toContain("members.permissions.youLack");
    fireEvent.click(grant);
    expect(h.grant).not.toHaveBeenCalled();
    expect(useNotificationStore.getState().toasts.map((x) => x.message)).toEqual(["members.permissions.youLack"]);
  });

  test("remove_greyed_without_manage_members_shows_the_reason_and_does_not_open_offboarding", () => {
    h.model = makeModel({ canManageMembers: false });
    renderScreen();
    const remove = q("[data-member-remove]")!;
    expect(remove.getAttribute("aria-disabled")).toBe("true");
    expect(q("[data-member-remove-reason]")!.textContent).toBe("members.permissions.youLack");
    fireEvent.click(remove);
    expect(q("[data-test-offboarding]")).toBeNull();
    expect(useNotificationStore.getState().toasts.map((x) => x.message)).toEqual(["members.permissions.youLack"]);
  });

  test("permissions_section_hidden_when_server_lacks_overrides", async () => {
    const legacy = makeMember("ana", ["r-mem"], { handle: "amber", joined_at: "2024-03-04" });
    h.model = makeModel({ members: [BOSS, legacy] });
    renderScreen();
    await keyRow();
    expect(q("[data-member-section='permissions']")).toBeNull();
    expect(q("[data-member-section='roles']")).not.toBeNull();
  });

  test("member_gone_pops_back_to_the_list", () => {
    const { rerender } = renderScreen();
    h.model = makeModel({ members: [BOSS] });
    rerender(<MobileMemberScreen teamId="t1" userId="ana" />);
    rerender(<MobileMemberScreen teamId="t1" userId="ana" />);
    expect(useMobileNavStore.getState().stack).toEqual([LIST]);
  });

  test("kick_opens_offboarding_and_pops_on_done", async () => {
    const { rerender } = renderScreen();
    fireEvent.click(q("[data-member-remove]")!);
    const dialog = q("[data-test-offboarding='ana']")!;
    expect(dialog).not.toBeNull();
    fireEvent.click(dialog);
    expect(useMobileNavStore.getState().stack).toEqual([LIST]);
    expect(h.model.reload).toHaveBeenCalled();
    h.model = makeModel({ members: [BOSS] });
    rerender(<MobileMemberScreen teamId="t1" userId="ana" />);
    expect(useMobileNavStore.getState().stack).toEqual([LIST]);
  });
});
