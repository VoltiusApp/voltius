import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  list: vi.fn(),
  restore: vi.fn(),
  reload: vi.fn(),
  addToast: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/vault", () => ({
  listVaultBackups: h.list,
  restoreVaultBackup: h.restore,
}));
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: (sel: (s: unknown) => unknown) => sel({ addToast: h.addToast }),
}));

import { VaultBackups } from "./VaultBackups";

const backup = (stamp: number, file = `secrets.enc.${stamp}.bak`) => ({
  file,
  stamp_millis: stamp,
  size: 2048,
});

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.list.mockResolvedValue([backup(1_700_000_000_000), backup(1_600_000_000_000)]);
  h.restore.mockResolvedValue("secrets.enc.1800000000000.bak");
  vi.stubGlobal("location", { reload: h.reload });
});

test("lists every backup on disk", async () => {
  render(<VaultBackups currentReadable={false} />);

  await waitFor(() => expect(screen.getByText("secrets.enc.1700000000000.bak")).toBeTruthy());
  expect(screen.getByText("secrets.enc.1600000000000.bak")).toBeTruthy();
});

// Restoring replaces the live vault. It must never happen on one stray click.
test("restoring takes a confirmation", async () => {
  render(<VaultBackups currentReadable={false} />);
  await waitFor(() => expect(screen.getAllByText("shared.vaultBackups.restore")).toHaveLength(2));

  await userEvent.click(screen.getAllByText("shared.vaultBackups.restore")[0]);

  expect(h.restore).not.toHaveBeenCalled();
  expect(screen.getByText("shared.vaultBackups.confirm")).toBeTruthy();

  await userEvent.click(screen.getByText("shared.vaultBackups.confirm"));

  await waitFor(() => expect(h.restore).toHaveBeenCalledWith("secrets.enc.1700000000000.bak"));
  expect(h.reload).toHaveBeenCalled();
});

// A readable vault is about to be displaced, so the warning has to say so.
test("the confirmation says the current vault is readable when it is", async () => {
  render(<VaultBackups currentReadable />);
  await waitFor(() => expect(screen.getAllByText("shared.vaultBackups.restore")[0]).toBeTruthy());

  await userEvent.click(screen.getAllByText("shared.vaultBackups.restore")[0]);

  expect(screen.getByText("shared.vaultBackups.warnReadable")).toBeTruthy();
});

test("cancelling leaves the vault alone", async () => {
  render(<VaultBackups currentReadable={false} />);
  await waitFor(() => expect(screen.getAllByText("shared.vaultBackups.restore")[0]).toBeTruthy());

  await userEvent.click(screen.getAllByText("shared.vaultBackups.restore")[0]);
  await userEvent.click(screen.getByText("shared.vaultBackups.cancel"));

  expect(h.restore).not.toHaveBeenCalled();
  expect(screen.queryByText("shared.vaultBackups.confirm")).toBeNull();
});

test("a failed restore is reported and the page is not reloaded", async () => {
  h.restore.mockImplementation(async () => {
    throw new Error("That backup is no longer on disk");
  });
  render(<VaultBackups currentReadable={false} />);
  await waitFor(() => expect(screen.getAllByText("shared.vaultBackups.restore")[0]).toBeTruthy());

  await userEvent.click(screen.getAllByText("shared.vaultBackups.restore")[0]);
  await userEvent.click(screen.getByText("shared.vaultBackups.confirm"));

  await waitFor(() => expect(screen.getByText("That backup is no longer on disk")).toBeTruthy());
  expect(h.reload).not.toHaveBeenCalled();
});

test("says so when there is nothing to restore", async () => {
  h.list.mockResolvedValue([]);
  render(<VaultBackups currentReadable />);

  await waitFor(() => expect(screen.getByText("shared.vaultBackups.empty")).toBeTruthy());
});

// The recovery screen must stay focused on its one offer when there is nothing here.
test("renders nothing on an empty list when asked to hide", async () => {
  h.list.mockResolvedValue([]);
  const { container } = render(<VaultBackups currentReadable={false} hideWhenEmpty />);

  await waitFor(() => expect(h.list).toHaveBeenCalled());
  expect(container.textContent).toBe("");
});
