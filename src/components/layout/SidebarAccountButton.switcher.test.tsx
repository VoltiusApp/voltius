import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SavedAccount } from "@/services/savedAccounts";

const h = vi.hoisted(() => ({
  accountMode: "server" as string,
  getSavedAccounts: vi.fn(async (): Promise<SavedAccount[]> => []),
  saveCurrentAccount: vi.fn(async () => {}),
  switchToAccount: vi.fn(async () => {}),
  removeSavedAccount: vi.fn(async () => {}),
  keychain: {} as Record<string, string | null>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (_cmd: string, args: { key: string }) => h.keychain[args.key] ?? null),
}));
vi.mock("@/services/account", () => ({
  getAccountMode: vi.fn(async () => h.accountMode),
  getMyHandle: vi.fn(async () => "ada"),
  lockVaultSession: vi.fn(async () => {}),
  logout: vi.fn(async () => {}),
}));
vi.mock("@/services/savedAccounts", () => ({
  getSavedAccounts: h.getSavedAccounts,
  saveCurrentAccount: h.saveCurrentAccount,
  switchToAccount: h.switchToAccount,
  removeSavedAccount: h.removeSavedAccount,
}));

import { SidebarAccountButton } from "./SidebarAccountButton";

const CURRENT = {
  account_id: "current", mode: "server", master_password: ["master", "for", "current"].join("-"),
  email: "ada@example.com", server_url: "https://srv", jwt: null, refresh_token: null,
} satisfies SavedAccount;

const OTHER = { ...CURRENT, account_id: "other", email: "grace@example.com" } satisfies SavedAccount;

beforeEach(() => {
  vi.clearAllMocks();
  h.accountMode = "server";
  h.keychain = { email: CURRENT.email, account_id: CURRENT.account_id };
});
afterEach(cleanup);

async function openMenu() {
  render(<SidebarAccountButton />);
  await userEvent.click(screen.getByTitle("layout.sidebarAccount.accountTitle"));
  await waitFor(() => expect(h.getSavedAccounts).toHaveBeenCalled());
}

test("the switch section stays hidden when the only saved account is the current one", async () => {
  h.getSavedAccounts.mockResolvedValue([CURRENT]);
  await openMenu();
  expect(screen.queryByText("layout.sidebarAccount.switchAccount")).toBeNull();
});

test("a saved account other than the current one is offered as a switch target", async () => {
  h.getSavedAccounts.mockResolvedValue([CURRENT, OTHER]);
  await openMenu();

  await screen.findByText("layout.sidebarAccount.switchAccount");
  expect(screen.getByText(OTHER.email!)).toBeTruthy();
  expect(screen.queryAllByText(CURRENT.email!)).toHaveLength(1); // the header only

  await userEvent.click(screen.getByText(OTHER.email!));
  expect(h.switchToAccount).toHaveBeenCalledWith(OTHER);
});

test("removing a saved account does not switch into it", async () => {
  h.getSavedAccounts.mockResolvedValue([CURRENT, OTHER]);
  await openMenu();

  await userEvent.click(await screen.findByTitle("layout.sidebarAccount.removeSavedAccount"));
  expect(h.removeSavedAccount).toHaveBeenCalledWith(OTHER.account_id);
  expect(h.switchToAccount).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByText(OTHER.email!)).toBeNull());
});

test("no switch row nests a button inside a button", async () => {
  h.getSavedAccounts.mockResolvedValue([CURRENT, OTHER]);
  await openMenu();
  await screen.findByText(OTHER.email!);
  expect(document.querySelectorAll("button button")).toHaveLength(0);
});

test("switching away from a local account asks before erasing it", async () => {
  h.accountMode = "local-nopassword";
  h.getSavedAccounts.mockResolvedValue([OTHER]);
  await openMenu();

  await userEvent.click(await screen.findByText(OTHER.email!));
  expect(h.switchToAccount).not.toHaveBeenCalled();
  await screen.findByText("layout.sidebarAccount.leaveLocalTitle");

  await userEvent.click(screen.getByText("layout.sidebarAccount.leaveLocalConfirm"));
  expect(h.switchToAccount).toHaveBeenCalledWith(OTHER);
});

test("cancelling the local-account warning leaves the session alone", async () => {
  h.accountMode = "local-nopassword";
  h.getSavedAccounts.mockResolvedValue([OTHER]);
  await openMenu();

  await userEvent.click(await screen.findByText(OTHER.email!));
  await userEvent.click(await screen.findByText("common.action.cancel"));
  expect(h.switchToAccount).not.toHaveBeenCalled();
  expect(screen.queryByText("layout.sidebarAccount.leaveLocalTitle")).toBeNull();
});
