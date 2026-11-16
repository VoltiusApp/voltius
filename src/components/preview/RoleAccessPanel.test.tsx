import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { PreviewResponse } from "@/services/permissionPreview";
import { PERM_BITS } from "@/services/permissions";

const h = vi.hoisted(() => ({ preview: vi.fn(), locked: { value: false }, can: { value: ((_p: string) => true) as (p: string) => boolean } }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${Object.values(o).join("|")}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/sync", () => ({ onTeamSseEvent: () => () => {} }));
vi.mock("@/services/permissionPreview", async (orig) => ({
  ...(await orig<typeof import("@/services/permissionPreview")>()),
  previewPermissions: h.preview,
}));
vi.mock("@/hooks/useBusinessLock", () => ({ useBusinessLock: () => ({ locked: h.locked.value, isOwner: true }) }));
vi.mock("@/hooks/usePermission", async (orig) => ({
  ...(await orig<typeof import("@/hooks/usePermission")>()),
  useOwnPermissions: () => (p: string) => h.can.value(p),
}));

import { RoleAccessPanel } from "./RoleAccessPanel";
import { usePreviewStore } from "@/stores/previewStore";
import { useTeamStore } from "@/stores/teamStore";
import { useUIStore } from "@/stores/uiStore";
import { useVaultStore } from "@/stores/vaultStore";
import { makeMember, makeRole, makeTeam } from "@/test/team";

const roleSession = (roleId: string) => ({ teamId: "team-1", vaultId: "team-1", subject: { type: "role" as const, role_id: roleId } });
const side = (bits: number) => ({ team_bits: bits, objects: {}, rule_sets: {}, holds_vault_key_gate: true });
const response = (affected: PreviewResponse["affected"] = null): PreviewResponse => ({
  locked: false, current: side(PERM_BITS.VIEW_SECRETS), draft: affected ? side(PERM_BITS.VIEW_SECRETS | PERM_BITS.CONNECT) : null, affected,
});

const PERM_DESC = "settings.vaults.rolesPanel.perm.CONNECT";
const updateRole = vi.fn();
const loadRoles = vi.fn();

const enter = async (roleId: string) => {
  usePreviewStore.getState().enter(roleSession(roleId));
  await waitFor(() => expect(usePreviewStore.getState().status).toBe("ready"));
};

beforeEach(() => {
  h.locked.value = false;
  h.can.value = () => true;
  h.preview.mockReset().mockResolvedValue(response());
  updateRole.mockReset().mockResolvedValue(undefined);
  loadRoles.mockReset().mockResolvedValue(undefined);
  useVaultStore.setState({ selectedVaultIds: ["team-1"] });
  useUIStore.setState({ homeView: false, activeNav: "members", sftpPanelOpen: false, settingsOpen: false });
  useTeamStore.setState({
    teams: [makeTeam("team-1")],
    rolesByTeam: { "team-1": [makeRole("r-admin", PERM_BITS.VIEW_SECRETS, { name: "admin", is_builtin: true }), makeRole("r-ed", PERM_BITS.VIEW_SECRETS, { name: "editor" })] },
    membersByTeam: { "team-1": [makeMember("bob", ["r-ed"], { member_name: "Bob" }), makeMember("amy", ["r-ed"], { member_name: "Amy" })] },
    updateRole, loadRoles,
  });
});
afterEach(() => { cleanup(); usePreviewStore.getState().exit(); });

test("builtin_role_is_read_only", async () => {
  await enter("r-admin");
  render(<RoleAccessPanel />);
  expect(screen.getByText("members.viewAs.builtinReadOnly")).toBeTruthy();
  fireEvent.click(screen.getByText(PERM_DESC));
  expect(usePreviewStore.getState().draft).toBeNull();
});

test("drafting_bits_refetches_and_lists_affected_members", async () => {
  h.preview.mockResolvedValue(response({ changed: ["bob", "amy"], lose_vault_key: [] }));
  await enter("r-ed");
  render(<RoleAccessPanel />);
  fireEvent.click(screen.getByText(PERM_DESC));
  expect(usePreviewStore.getState().draft).toMatchObject({ permissions: expect.any(Number) });
  await waitFor(() => expect(h.preview).toHaveBeenCalledTimes(2));
  fireEvent.click(await screen.findByText(/members\.viewAs\.affects/));
  expect(screen.getByText(/Bob/)).toBeTruthy();
  expect(screen.getByText(/Amy/)).toBeTruthy();
});

test("save_patches_the_role_and_clears_the_draft", async () => {
  await enter("r-ed");
  usePreviewStore.getState().setDraft({ permissions: PERM_BITS.VIEW_SECRETS | PERM_BITS.CONNECT });
  await usePreviewStore.getState().save();
  expect(updateRole).toHaveBeenCalledWith("team-1", "r-ed", { permissions: PERM_BITS.VIEW_SECRETS | PERM_BITS.CONNECT });
  expect(loadRoles).toHaveBeenCalledWith("team-1");
  expect(usePreviewStore.getState().draft).toBeNull();
  expect(usePreviewStore.getState().saving).toBe(false);
});

test("a_failed_role_save_keeps_the_draft", async () => {
  await enter("r-ed");
  const draft = { permissions: PERM_BITS.VIEW_SECRETS | PERM_BITS.CONNECT };
  usePreviewStore.getState().setDraft(draft);
  updateRole.mockRejectedValue(new Error("nope"));
  await usePreviewStore.getState().save();
  expect(usePreviewStore.getState().draft).toEqual(draft);
  expect(usePreviewStore.getState().saveError).toBe("nope");
});

test("a_locked_custom_role_renders_disabled_with_the_lock_line", async () => {
  h.locked.value = true;
  await enter("r-ed");
  render(<RoleAccessPanel />);
  expect(screen.getByText("shared.businessLock.rolesBody")).toBeTruthy();
  fireEvent.click(screen.getByText(PERM_DESC));
  expect(usePreviewStore.getState().draft).toBeNull();
});
