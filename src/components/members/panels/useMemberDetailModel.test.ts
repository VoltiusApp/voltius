// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({
  bits: 0,
  losesVaultKey: vi.fn(async () => false),
  rotate: vi.fn(async () => ({})),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/hooks/usePermission", async () =>
  (await import("@/test/memberPermissions")).memberPermissions(() => h.bits, { subject: "boss" }));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/services/serverCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/services/serverCapabilities")>()),
  getServerCapability: (flag: string) => flag === "permissionPreview",
  useServerMultiOwner: () => true,
  useServerBillingEnabled: () => false,
}));
vi.mock("@/services/permissionPreview", () => ({ losesVaultKey: h.losesVaultKey }));
vi.mock("@/services/vaultKeyActions", () => ({ rotateTeamKeyNow: h.rotate }));
vi.mock("@/services/appToast", () => ({ appToast: vi.fn() }));

import { useMemberDetailModel } from "./useMemberDetailModel";
import { useTeamStore, type TeamMember } from "@/stores/teamStore";
import { useHistoryStore } from "@/stores/historyStore";
import { PERM_BITS } from "@/services/permissions";
import { makeMember, makeRole, makeTeam } from "@/test/team";
import { startPreview, stopPreview } from "@/test/preview";

const OWNER = makeRole("r-owner", 0, { name: "owner", is_builtin: true, position: 0 });
const MEMBER = makeRole("r-mem", PERM_BITS.CONNECT | PERM_BITS.VIEW, { name: "member", is_builtin: true, position: 1 });
const EDITOR = makeRole("r-ed", 0, { name: "editor", position: 2 });
const ROLES = [OWNER, MEMBER, EDITOR];
const BOSS = makeMember("boss", ["r-owner"], { handle: "zed", permission_allow: 0, permission_deny: 0 });
const U1 = makeMember("u1", ["r-mem", "r-ed"], { handle: "amber", permission_allow: 0, permission_deny: 0 });

const assignMemberRole = vi.fn(async () => {});
const removeMemberRole = vi.fn(async () => {});
const setMemberPermissions = vi.fn(async () => {});
const onUpdated = vi.fn();

const model = (member: TeamMember) => renderHook(() => useMemberDetailModel({
  member,
  isMe: false,
  teamId: "t1",
  teamRoles: ROLES,
  canManageMembers: true,
  canNameMembers: true,
  isTargetOwner: member.role_ids.includes("r-owner"),
  viewer: BOSS,
  onUpdated,
})).result;

beforeEach(() => {
  vi.clearAllMocks();
  h.bits = PERM_BITS.ADMINISTRATOR | PERM_BITS.MANAGE_MEMBERS | PERM_BITS.CONNECT | PERM_BITS.VIEW;
  h.losesVaultKey.mockResolvedValue(false);
  useHistoryStore.setState({ past: [], future: [] } as never);
  useTeamStore.setState({
    teams: [makeTeam("t1", { owner_id: "boss" })],
    membersByTeam: { t1: [BOSS, U1] },
    rolesByTeam: { t1: ROLES },
    assignMemberRole,
    removeMemberRole,
    setMemberPermissions,
  });
});
afterEach(() => {
  stopPreview();
  cleanup();
});

test("toggle_owner_role_asks_for_ownership_confirm", async () => {
  const result = model(U1);
  expect(result.current.roles.showOwner).toBe(true);
  await act(async () => { result.current.roles.toggle(OWNER); });
  expect(result.current.dialogs.ownerRole?.kind).toBe("grant");
  expect(assignMemberRole).not.toHaveBeenCalled();
  await act(async () => { result.current.dialogs.ownerRole?.confirm(); });
  expect(result.current.dialogs.ownerRole).toBeNull();
  expect(assignMemberRole).toHaveBeenCalledWith("t1", "u1", "r-owner");
});

test("toggle_off_last_connect_role_asks_to_revoke_key", async () => {
  h.losesVaultKey.mockResolvedValue(true);
  const result = model(U1);
  await act(async () => { result.current.roles.toggle(MEMBER); });
  expect(h.losesVaultKey).toHaveBeenCalledWith("t1", "u1", { role_ids: ["r-ed"], allow: 0, deny: 0 });
  expect(result.current.dialogs.revokeKey).not.toBeNull();
  expect(removeMemberRole).not.toHaveBeenCalled();
  await act(async () => { result.current.dialogs.revokeKey?.confirm(); });
  expect(removeMemberRole).toHaveBeenCalledWith("t1", "u1", "r-mem");
  expect(h.rotate).toHaveBeenCalledWith("t1");
  expect(useHistoryStore.getState().past).toHaveLength(1);
  expect(onUpdated).toHaveBeenCalled();
});

test("primary_owner_cannot_lose_owner_role", async () => {
  const result = model(BOSS);
  await act(async () => { result.current.roles.toggle(OWNER); });
  expect(result.current.error).toBe("members.error.cannotRemoveOwnerRole");
  expect(result.current.dialogs.ownerRole).toBeNull();
  expect(removeMemberRole).not.toHaveBeenCalled();
});

test("override_allow_refused_when_viewer_lacks_the_bit", async () => {
  h.bits = PERM_BITS.ADMINISTRATOR | PERM_BITS.MANAGE_MEMBERS;
  const result = model(U1);
  expect(result.current.overrides.visible).toBe(true);
  await act(async () => { result.current.overrides.setState("EDIT_SNIPPETS", "allow"); });
  expect(result.current.error).toBe("members.permissions.readOnlyNotHeld");
  expect(h.losesVaultKey).not.toHaveBeenCalled();
  expect(setMemberPermissions).not.toHaveBeenCalled();
});

test("toggle_is_refused_while_previewing", async () => {
  const result = model(U1);
  startPreview();
  await act(async () => {
    result.current.roles.toggle(EDITOR);
    result.current.roles.toggle(OWNER);
  });
  expect(h.losesVaultKey).not.toHaveBeenCalled();
  expect(removeMemberRole).not.toHaveBeenCalled();
  expect(result.current.dialogs.ownerRole).toBeNull();
  expect(result.current.dialogs.revokeKey).toBeNull();
});
