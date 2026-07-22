import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { TeamRole } from "@/services/teamService";

const api = vi.hoisted(() => ({
  createRole: vi.fn(async () => ({}) as TeamRole),
  updateRole: vi.fn(async () => {}),
  listRoles: vi.fn(async () => []),
  listMembers: vi.fn(async () => []),
}));
vi.mock("@/services/teamService", () => api);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/theme-creator/ColorPicker", () => ({ ColorPicker: () => null }));

import { RoleModal, PERM_META } from "@/components/settings/sections/RolesSection";
import { PERM_BITS } from "@/hooks/usePermission";
import { useTeamStore } from "@/stores/teamStore";

const existingRole: TeamRole = {
  id: "r1",
  team_id: "t1",
  name: "Old",
  permissions: PERM_BITS.VIEW_SECRETS | PERM_BITS.CONNECT,
  color: "#123456",
  is_builtin: false,
  position: 100,
  created_at: "",
};

beforeEach(() => {
  localStorage.clear();
  api.createRole.mockReset().mockResolvedValue({} as TeamRole);
  api.updateRole.mockReset().mockResolvedValue(undefined);
  useTeamStore.setState({
    teams: [], membersByTeam: {}, rolesByTeam: {},
    pendingInvitationsByTeam: {}, myPendingInvitations: [], activeTeamId: null, loading: false,
  });
});
afterEach(() => cleanup());

function nameInput() {
  return screen.getByPlaceholderText("settings.vaults.rolesPanel.roleNamePlaceholder") as HTMLInputElement;
}
function clickPerm(perm: keyof typeof PERM_BITS) {
  const label = screen.getByText(`settings.vaults.rolesPanel.perm.${perm}.label`).closest("label");
  fireEvent.click(label!);
}

test("create: createRole(teamId, trimmed name, permissions=0, undefined color) then onClose", async () => {
  const onClose = vi.fn();
  render(<RoleModal teamId="t1" role={null} onClose={onClose} />);
  fireEvent.change(nameInput(), { target: { value: "  Dev  " } });
  fireEvent.click(screen.getByText("settings.vaults.rolesPanel.createRole"));

  await waitFor(() => expect(api.createRole).toHaveBeenCalled());
  expect(api.createRole).toHaveBeenCalledWith("t1", "Dev", 0, undefined);
  expect(api.updateRole).not.toHaveBeenCalled();
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("permission toggle flips exactly the clicked bit into the saved permissions", async () => {
  render(<RoleModal teamId="t1" role={null} onClose={vi.fn()} />);
  fireEvent.change(nameInput(), { target: { value: "Perms" } });
  clickPerm("VIEW_SECRETS");
  clickPerm("COPY_SECRETS");
  fireEvent.click(screen.getByText("settings.vaults.rolesPanel.createRole"));

  await waitFor(() => expect(api.createRole).toHaveBeenCalled());
  expect(api.createRole).toHaveBeenCalledWith(
    "t1", "Perms", PERM_BITS.VIEW_SECRETS | PERM_BITS.COPY_SECRETS, undefined,
  );
});

test("permission toggle twice on same bit clears it (XOR)", async () => {
  render(<RoleModal teamId="t1" role={null} onClose={vi.fn()} />);
  fireEvent.change(nameInput(), { target: { value: "Perms" } });
  clickPerm("VIEW_SECRETS");
  clickPerm("VIEW_SECRETS");
  fireEvent.click(screen.getByText("settings.vaults.rolesPanel.createRole"));

  await waitFor(() => expect(api.createRole).toHaveBeenCalled());
  expect(api.createRole).toHaveBeenCalledWith("t1", "Perms", 0, undefined);
});

test("preset color select then create: color forwarded to createRole", async () => {
  render(<RoleModal teamId="t1" role={null} onClose={vi.fn()} />);
  fireEvent.change(nameInput(), { target: { value: "Colorful" } });
  fireEvent.click(screen.getByTitle("#8b5cf6"));
  fireEvent.click(screen.getByText("settings.vaults.rolesPanel.createRole"));

  await waitFor(() => expect(api.createRole).toHaveBeenCalled());
  expect(api.createRole).toHaveBeenCalledWith("t1", "Colorful", 0, "#8b5cf6");
});

test("preset color toggled off (click same swatch twice): undefined color", async () => {
  render(<RoleModal teamId="t1" role={null} onClose={vi.fn()} />);
  fireEvent.change(nameInput(), { target: { value: "Colorful" } });
  fireEvent.click(screen.getByTitle("#8b5cf6"));
  fireEvent.click(screen.getByTitle("#8b5cf6"));
  fireEvent.click(screen.getByText("settings.vaults.rolesPanel.createRole"));

  await waitFor(() => expect(api.createRole).toHaveBeenCalled());
  expect(api.createRole).toHaveBeenCalledWith("t1", "Colorful", 0, undefined);
});

test("edit: updateRole(teamId, roleId, {name, permissions, color}) preserving untouched fields", async () => {
  const onClose = vi.fn();
  render(<RoleModal teamId="t1" role={existingRole} onClose={onClose} />);
  expect(nameInput().value).toBe("Old");
  fireEvent.change(nameInput(), { target: { value: "New" } });
  fireEvent.click(screen.getByText("settings.vaults.rolesPanel.saveChanges"));

  await waitFor(() => expect(api.updateRole).toHaveBeenCalled());
  expect(api.updateRole).toHaveBeenCalledWith("t1", "r1", {
    name: "New",
    permissions: PERM_BITS.VIEW_SECRETS | PERM_BITS.CONNECT,
    color: "#123456",
  });
  expect(api.createRole).not.toHaveBeenCalled();
  await waitFor(() => expect(onClose).toHaveBeenCalled());
});

test("edit: toggling an already-set bit off is reflected in updateRole permissions", async () => {
  render(<RoleModal teamId="t1" role={existingRole} onClose={vi.fn()} />);
  clickPerm("VIEW_SECRETS");
  fireEvent.click(screen.getByText("settings.vaults.rolesPanel.saveChanges"));

  await waitFor(() => expect(api.updateRole).toHaveBeenCalled());
  expect(api.updateRole).toHaveBeenCalledWith("t1", "r1", expect.objectContaining({
    permissions: PERM_BITS.CONNECT,
  }));
});

test("empty name via Enter: name-required error shown, no service call", async () => {
  render(<RoleModal teamId="t1" role={null} onClose={vi.fn()} />);
  fireEvent.keyDown(nameInput(), { key: "Enter" });

  expect(await screen.findByText("settings.vaults.rolesPanel.errorNameRequired")).toBeTruthy();
  expect(api.createRole).not.toHaveBeenCalled();
});

test("save failure surfaces error message, modal stays open (onClose not called)", async () => {
  const onClose = vi.fn();
  api.createRole.mockRejectedValue(new Error("boom-save"));
  render(<RoleModal teamId="t1" role={null} onClose={onClose} />);
  fireEvent.change(nameInput(), { target: { value: "X" } });
  fireEvent.click(screen.getByText("settings.vaults.rolesPanel.createRole"));

  expect(await screen.findByText("boom-save")).toBeTruthy();
  expect(onClose).not.toHaveBeenCalled();
});

test("PERM_META covers every PERM_BITS permission", () => {
  for (const perm of Object.keys(PERM_BITS)) {
    expect(PERM_META[perm as keyof typeof PERM_META]).toBeTruthy();
  }
});
