import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

const h = vi.hoisted(() => ({
  rename: vi.fn(), remove: vi.fn(), makePrivate: vi.fn(async () => {}),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useVaultContents", () => ({ useVaultContents: () => [] }));
vi.mock("./useVaultAdminActions", () => ({
  useVaultAdminActions: () => ({ busy: false, rename: h.rename, remove: h.remove, makePrivate: h.makePrivate }),
}));
// VaultAdminDialogs calls useTeamStore() with no selector, so the mock must
// work when called with no arguments. The state lives inside the factory: a
// vi.mock factory is hoisted above module scope and cannot close over an
// outer const.
vi.mock("@/stores/teamStore", () => {
  const teamState = { teams: [], rolesByTeam: {}, membersByTeam: {} };
  return {
    useTeamStore: Object.assign(
      (sel?: (s: typeof teamState) => unknown) => (sel ? sel(teamState) : teamState),
      { getState: () => teamState },
    ),
  };
});

import { VaultAdminDialogs } from "./VaultAdminDialogs";
import type { VaultAdminTarget } from "./vaultAdminTarget";

const target: VaultAdminTarget =
  { kind: "local", vaultId: "v1", teamId: null, name: "My Vault" };

beforeEach(() => { for (const fn of Object.values(h)) fn.mockReset(); h.makePrivate.mockResolvedValue(undefined); });
afterEach(cleanup);

test("no dialog renders nothing", () => {
  const { container } = render(
    <VaultAdminDialogs target={target} dialog={null} onClose={vi.fn()} />,
  );
  expect(container.firstChild).toBeNull();
});

test("the rename dialog opens with the current name and commits the edit", () => {
  const onClose = vi.fn();
  render(<VaultAdminDialogs target={target} dialog="rename" onClose={onClose} />);
  const input = screen.getByLabelText("settings.vaults.general.vaultNameLabel") as HTMLInputElement;
  expect(input.value).toBe("My Vault");
  fireEvent.change(input, { target: { value: "Renamed" } });
  fireEvent.click(screen.getByText("settings.vaults.general.save"));
  expect(h.rename).toHaveBeenCalledWith("Renamed");
  expect(onClose).toHaveBeenCalled();
});

test("Enter on an emptied name neither renames nor closes the dialog", () => {
  const onClose = vi.fn();
  render(<VaultAdminDialogs target={target} dialog="rename" onClose={onClose} />);
  const input = screen.getByLabelText("settings.vaults.general.vaultNameLabel") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "   " } });
  fireEvent.keyDown(document, { key: "Enter" });
  expect(h.rename).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
});

test("the delete dialog needs an explicit confirm and then deletes once", () => {
  render(<VaultAdminDialogs target={target} dialog="delete" onClose={vi.fn()} />);
  expect(h.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("settings.vaults.general.deleteVault.confirmBtn"));
  expect(h.remove).toHaveBeenCalledTimes(1);
});

test("cancelling the delete dialog deletes nothing", () => {
  const onClose = vi.fn();
  render(<VaultAdminDialogs target={target} dialog="delete" onClose={onClose} />);
  fireEvent.click(screen.getByText("common.action.cancel"));
  expect(h.remove).not.toHaveBeenCalled();
  expect(onClose).toHaveBeenCalled();
});

test("the make-private dialog uses the warning tone, not the danger tone", () => {
  const teamTarget: VaultAdminTarget = { ...target, teamId: "t1" };
  render(<VaultAdminDialogs target={teamTarget} dialog="makePrivate" onClose={vi.fn()} />);
  const btn = screen.getByText("settings.vaults.general.makePrivate.confirmBtn");
  expect(btn.className).toContain("btn-warning");
  expect(btn.className).not.toContain("btn-danger");
});
