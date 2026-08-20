import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SavedAccount } from "@/services/savedAccounts";
import { DEFAULT_SERVER_URL } from "@/utils/serverInstance";

const h = vi.hoisted(() => ({
  accountMode: "server" as string,
  getSavedAccounts: vi.fn(async (): Promise<SavedAccount[]> => []),
  saveCurrentAccount: vi.fn(async () => {}),
  switchToAccount: vi.fn(async () => {}),
  signOutToAddAccount: vi.fn(async () => {}),
  removeSavedAccount: vi.fn(async () => {}),
  keychain: {} as Record<string, string | null>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({
  Icon: ({ icon }: { icon: string }) => <i data-icon={icon} />,
}));
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
  signOutToAddAccount: h.signOutToAddAccount,
  removeSavedAccount: h.removeSavedAccount,
}));

import { SidebarAccountButton } from "./SidebarAccountButton";
import { useUIStore } from "@/stores/uiStore";
import { useSecurityStore } from "@/stores/securityStore";
import { useNotificationStore } from "@/stores/notificationStore";

const CURRENT = {
  account_id: "current", mode: "server", master_password: ["master", "for", "current"].join("-"),
  email: "ada@example.com", server_url: DEFAULT_SERVER_URL, jwt: null, refresh_token: null,
} satisfies SavedAccount;

const OTHER = { ...CURRENT, account_id: "other", email: "grace@example.com" } satisfies SavedAccount;

/** Same person, same email, other instance — the case the row could not tell apart. */
const SELF_HOSTED = {
  ...CURRENT, account_id: "self-hosted", server_url: "https://stackdome.example.tld",
} satisfies SavedAccount;

beforeEach(() => {
  vi.clearAllMocks();
  h.accountMode = "server";
  h.keychain = { email: CURRENT.email, account_id: CURRENT.account_id };
  useNotificationStore.setState({ toasts: [] });
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

test("a no-password local account is not offered a lock it cannot perform", async () => {
  h.accountMode = "local-nopassword";
  await openMenu();
  expect(screen.queryByText("layout.sidebarAccount.lockVault")).toBeNull();
  expect(screen.queryByText("layout.sidebarAccount.autoLock")).toBeNull();
});

test("the lock row reports the current auto-lock setting", async () => {
  useSecurityStore.getState().setSessionTimeoutMinutes(15);
  await openMenu();
  await screen.findByText("layout.sidebarAccount.lockVault");
  expect(screen.getByText("layout.sidebarAccount.autoLockAfter")).toBeTruthy();

  useSecurityStore.getState().setSessionTimeoutMinutes(null);
});

test("the auto-lock row opens the account settings section", async () => {
  useUIStore.setState({ settingsOpen: false, settingsSection: "appearance" });
  await openMenu();

  await userEvent.click(await screen.findByText("layout.sidebarAccount.autoLock"));
  expect(useUIStore.getState().settingsOpen).toBe(true);
  expect(useUIStore.getState().settingsSection).toBe("account");
});

test("a cloud account can add another one without signing out", async () => {
  await openMenu();
  await userEvent.click(await screen.findByText("layout.sidebarAccount.addAccount"));
  expect(h.signOutToAddAccount).toHaveBeenCalled();
});

test("a local account is not offered the add-account route", async () => {
  h.accountMode = "local";
  await openMenu();
  expect(screen.queryByText("layout.sidebarAccount.addAccount")).toBeNull();
});

/**
 * A keychain that refuses the write is how an account went missing from the
 * switcher without a word — the save failure was caught and dropped.
 */
test("a switcher save the keychain refuses is reported", async () => {
  h.saveCurrentAccount.mockRejectedValueOnce(new Error("Keychain write error: too long"));
  await openMenu();

  await waitFor(() =>
    expect(
      useNotificationStore.getState().toasts.some((toast) =>
        toast.message.startsWith("layout.sidebarAccount.saveFailed"),
      ),
    ).toBe(true),
  );
});

test("two accounts on different instances are told apart by their row", async () => {
  h.getSavedAccounts.mockResolvedValue([CURRENT, OTHER, SELF_HOSTED]);
  await openMenu();

  await screen.findByText("stackdome.example.tld");
  expect(screen.getAllByText("layout.sidebarAccount.savedAccountCloud")).toHaveLength(1);
});

test("a self-hosted row is marked with a server icon and its full URL", async () => {
  h.getSavedAccounts.mockResolvedValue([CURRENT, SELF_HOSTED]);
  await openMenu();

  const row = (await screen.findByText("stackdome.example.tld")).closest("button");
  expect(row?.getAttribute("title")).toBe(SELF_HOSTED.server_url);
  expect(row?.querySelector('[data-icon="lucide:server"]')).toBeTruthy();
});

test("the header names the instance the current account is signed in to", async () => {
  h.keychain = { ...h.keychain, server_url: SELF_HOSTED.server_url };
  h.getSavedAccounts.mockResolvedValue([CURRENT]);
  await openMenu();

  await screen.findByText("stackdome.example.tld");
  expect(screen.queryByText("layout.sidebarAccount.modeCloud")).toBeNull();
});

test("the header still reads Cloud account on the official instance", async () => {
  h.keychain = { ...h.keychain, server_url: DEFAULT_SERVER_URL };
  await openMenu();

  await screen.findByText("layout.sidebarAccount.modeCloud");
});

test("adding another account stops when the current one could not be saved", async () => {
  h.signOutToAddAccount.mockRejectedValueOnce(new Error("Saved accounts could not be read"));
  await openMenu();

  await userEvent.click(await screen.findByText("layout.sidebarAccount.addAccount"));

  await waitFor(() =>
    expect(
      useNotificationStore.getState().toasts.some((toast) =>
        toast.message.startsWith("layout.sidebarAccount.saveFailed"),
      ),
    ).toBe(true),
  );
});
