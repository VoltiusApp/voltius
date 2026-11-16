// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { VaultAdminCapabilities } from "@/components/vault-admin/vaultAdminTarget";

const NONE: VaultAdminCapabilities = { isTeam: false, isOwner: false, canRename: false, canSetLockPolicy: false, canDelete: false, canMakePrivate: false, canLeave: false };
const h = vi.hoisted(() => ({
  rename: vi.fn(),
  state: { caps: {} as VaultAdminCapabilities, memberCount: null as number | null, canShare: false },
  vaults: [{ id: "personal", name: "Personal" }, { id: "v2", name: "Work", teamId: undefined as string | undefined }],
  dialogDone: null as null | (() => void),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("../MobileHeader", () => ({ APPBAR_TONAL: "" }));
vi.mock("@/hooks/useBackInterceptor", () => ({ useBackInterceptor: () => {} }));
vi.mock("@/hooks/useVaultContents", () => ({ useVaultContents: () => [] }));
vi.mock("@/utils/localeFormat", () => ({ formatRelative: () => "now" }));
vi.mock("@/services/memberLabel", () => ({ memberAvatarLabel: () => "M" }));
vi.mock("@/hooks/useMyUserId",() => ({ useMyUserId: () => "me" }));
vi.mock("@/services/sync", () => ({ getSyncState: () => ({ cloudActive: false, lastSync: null }), onSyncStateChange: () => () => {} }));
vi.mock("@/stores/subscriptionStore", () => ({ useSubscriptionStore: (sel: (s: object) => unknown) => sel({ accountMode: "local" }) }));
vi.mock("@/stores/vaultStore", () => ({ useVaultStore: (sel: (s: object) => unknown) => sel({ vaults: h.vaults }) }));
vi.mock("@/stores/teamStore", () => {
  const state = { teams: [], membersByTeam: {}, rolesByTeam: {}, loadMembers: async () => {}, loadRoles: async () => {} };
  return { useTeamStore: Object.assign((sel: (s: object) => unknown) => sel(state), { getState: () => state }) };
});
vi.mock("@/components/vault-admin/useVaultAdmin", () => ({ useVaultAdminState: () => h.state }));
vi.mock("@/components/vault-admin/useVaultAdminActions", () => ({ useVaultAdminActions: () => ({ rename: h.rename }) }));
vi.mock("@/components/vault-admin/VaultAdminDialogs", () => ({
  VaultAdminDialogs: ({ dialog, onDone }: { dialog: string | null; onDone: () => void }) => {
    h.dialogDone = onDone;
    return dialog ? <div data-test-dialog={dialog} /> : null;
  },
}));
vi.mock("@/components/vault-share/VaultShareSheet", () => ({
  VaultShareSheet: ({ initialTab, onOpenPeople }: { initialTab: string; onOpenPeople?: () => void }) => (
    <div data-test-share={initialTab}><button data-test-open-people onClick={onOpenPeople} /></div>
  ),
}));
vi.mock("./MobileMembersScreen", () => ({ default: ({ vaultId }: { vaultId: string }) => <div data-test-members={vaultId} /> }));
vi.mock("@/components/members/panels/RolesPanel", () => ({ TeamRolesPanel: () => <div data-test-roles /> }));
vi.mock("@/components/members/panels/SecurityPolicyPanel", () => ({ SecurityPolicyPanel: () => <div data-test-security /> }));

import MobileVaultSettingsScreen from "./MobileVaultSettingsScreen";
import { useMobileNavStore } from "@/stores/mobileNavStore";

beforeEach(() => {
  h.rename.mockReset();
  useMobileNavStore.setState({ stack: [{ kind: "vault-settings", vaultId: "v2" }], sheet: null });
});
afterEach(cleanup);

const rows = (c: HTMLElement) => [...c.querySelectorAll("[data-vault-settings-row]")].map((e) => e.getAttribute("data-vault-settings-row"));

test("the personal vault shows only its name", () => {
  h.state = { caps: { ...NONE, canRename: true }, memberCount: null, canShare: false };
  const { container } = render(<MobileVaultSettingsScreen vaultId="personal" />);
  expect(rows(container)).toEqual(["name"]);
  expect(container.querySelector("[data-vault-settings-name]")).not.toBeNull();
});

test("a team owner gets People and Danger rows; a sub-page row pushes its page", () => {
  h.state = { caps: { ...NONE, isTeam: true, isOwner: true, canRename: true, canSetLockPolicy: true, canDelete: true, canMakePrivate: true }, memberCount: 3, canShare: true };
  const { container } = render(<MobileVaultSettingsScreen vaultId="v2" />);
  expect(rows(container)).toEqual(["name", "share", "members", "roles", "security", "makePrivate", "delete"]);
  fireEvent.click(container.querySelector('[data-vault-settings-row="roles"]')!);
  expect(useMobileNavStore.getState().stack.slice(-1)[0]).toEqual({ kind: "vault-settings", vaultId: "v2", page: "roles" });
});

test("a member reads the name and leaves instead of deleting", () => {
  h.state = { caps: { ...NONE, isTeam: true, canLeave: true }, memberCount: 2, canShare: true };
  const { container } = render(<MobileVaultSettingsScreen vaultId="v2" />);
  expect(container.querySelector("[data-vault-settings-name]")).toBeNull();
  expect(container.querySelector("[data-vault-settings-name-readonly]")?.textContent).toBe("Work");
  expect(rows(container)).toEqual(["name", "share", "members", "roles", "leave"]);
});

test("renaming saves when the field loses focus", () => {
  h.state = { caps: { ...NONE, canRename: true, canDelete: true }, memberCount: null, canShare: false };
  const { container } = render(<MobileVaultSettingsScreen vaultId="v2" />);
  const input = container.querySelector<HTMLInputElement>("[data-vault-settings-name]")!;
  input.focus();
  fireEvent.change(input, { target: { value: "Work 2" } });
  fireEvent.blur(input);
  expect(h.rename).toHaveBeenCalledWith("Work 2");
});

test("an empty name is never saved and comes back on blur", () => {
  h.state = { caps: { ...NONE, canRename: true }, memberCount: null, canShare: false };
  const { container } = render(<MobileVaultSettingsScreen vaultId="v2" />);
  const input = container.querySelector<HTMLInputElement>("[data-vault-settings-name]")!;
  fireEvent.change(input, { target: { value: "  " } });
  expect(container.querySelector("[data-field-error]")).not.toBeNull();
  fireEvent.blur(input);
  expect(h.rename).not.toHaveBeenCalled();
  expect(input.value).toBe("Work");
});

test("delete opens the confirm dialog; once deleted the page closes", () => {
  h.state = { caps: { ...NONE, canRename: true, canDelete: true }, memberCount: null, canShare: false };
  const { container } = render(<MobileVaultSettingsScreen vaultId="v2" />);
  fireEvent.click(container.querySelector('[data-vault-settings-row="delete"]')!);
  expect(container.querySelector('[data-test-dialog="delete"]')).not.toBeNull();
  act(() => h.dialogDone!());
  expect(useMobileNavStore.getState().stack).toEqual([]);
});

test("sub-pages wrap the existing panels", () => {
  h.vaults = [{ id: "v2", name: "Work", teamId: "t1" }];
  const share = render(<MobileVaultSettingsScreen vaultId="v2" page="share" />);
  expect(share.container.querySelector('[data-test-share="invite"]')).not.toBeNull();
  cleanup();
  expect(render(<MobileVaultSettingsScreen vaultId="v2" page="roles" />).container.querySelector("[data-test-roles]")).not.toBeNull();
  cleanup();
  expect(render(<MobileVaultSettingsScreen vaultId="v2" page="security" />).container.querySelector("[data-test-security]")).not.toBeNull();
});

test("a vault that is gone says so", () => {
  const { container } = render(<MobileVaultSettingsScreen vaultId="nope" />);
  expect(container.querySelector("[data-vault-settings-gone]")).not.toBeNull();
});

test("the Members page is the native members screen, as the whole page", () => {
  h.vaults = [{ id: "v2", name: "Work", teamId: "t1" }];
  const { container } = render(<MobileVaultSettingsScreen vaultId="v2" page="members" />);
  expect(container.querySelector('[data-test-members="v2"]')).not.toBeNull();
  expect(container.querySelector("[data-test-share]")).toBeNull();
  expect(container.querySelector("[data-mobile-appbar]")).toBeNull();
});

test("the Share page pushes the Members page from its People tab", () => {
  h.vaults = [{ id: "v2", name: "Work", teamId: "t1" }];
  const { container } = render(<MobileVaultSettingsScreen vaultId="v2" page="share" />);
  fireEvent.click(container.querySelector("[data-test-open-people]")!);
  expect(useMobileNavStore.getState().stack.slice(-1)[0]).toEqual({ kind: "vault-settings", vaultId: "v2", page: "members" });
});
