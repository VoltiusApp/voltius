import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  authenticateServerAccount: vi.fn(),
  addAccount: vi.fn(async () => {}),
  signInToCloud: vi.fn(async () => {}),
  linkToCloud: vi.fn(async () => {}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/account", () => ({
  authenticateServerAccount: h.authenticateServerAccount,
  getAccountMode: vi.fn(async () => "server"),
  linkToCloud: h.linkToCloud,
  setMasterPassword: vi.fn(async () => {}),
  signInToCloud: h.signInToCloud,
}));
vi.mock("@/services/savedAccounts", () => ({ addAccount: h.addAccount }));
vi.mock("@/services/sync", () => ({
  startRealtimeSync: vi.fn(),
  syncOnLogin: vi.fn(async () => {}),
  syncOnLoginReplace: vi.fn(async () => {}),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: (sel: (s: unknown) => unknown) => sel({ load: vi.fn(async () => {}) }),
}));

import CloudAuthModal from "./CloudAuthModal";
import { useUIStore } from "@/stores/uiStore";

const SESSION = { account_id: "b", email: "b@x.io" };

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useUIStore.getState().openCloudAuth("signin", "add");
});

const submit = () => userEvent.click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);

function fill(email: string, ...passwords: string[]) {
  fireEvent.change(screen.getByPlaceholderText("layout.auth.emailPlaceholder"), { target: { value: email } });
  const fields = screen.getAllByPlaceholderText(/PasswordPlaceholder/);
  passwords.forEach((pw, i) => fireEvent.change(fields[i], { target: { value: pw } }));
}

test("signing in adds the account and switches to it", async () => {
  h.authenticateServerAccount.mockResolvedValue(SESSION);
  render(<CloudAuthModal />);

  fill("b@x.io", "pw-b");
  await submit();

  await waitFor(() => expect(h.addAccount).toHaveBeenCalledWith(SESSION));
  expect(h.authenticateServerAccount.mock.calls[0].slice(0, 3)).toEqual(["signin", "b@x.io", "pw-b"]);
  expect(h.signInToCloud).not.toHaveBeenCalled();
});

test("creating an account asks for a new password and confirms it", async () => {
  h.authenticateServerAccount.mockResolvedValue(SESSION);
  render(<CloudAuthModal />);
  await userEvent.click(screen.getAllByRole("button", { name: "layout.auth.createAccount" })[0]);

  fill("b@x.io", "longenough", "different!");
  await submit();

  expect(await screen.findByText("layout.auth.errorPasswordMismatch")).toBeTruthy();
  expect(h.authenticateServerAccount).not.toHaveBeenCalled();
  expect(h.linkToCloud).not.toHaveBeenCalled();
});

test("bad credentials stay in the modal and never reach the switch", async () => {
  h.authenticateServerAccount.mockRejectedValue(new Error("common.error.invalidEmailOrPassword"));
  render(<CloudAuthModal />);

  fill("b@x.io", "wrong");
  await submit();

  expect(await screen.findByText("common.error.invalidEmailOrPassword")).toBeTruthy();
  expect(h.addAccount).not.toHaveBeenCalled();
  expect(useUIStore.getState().cloudAuthOpen).toBe(true);
});

test("cancel closes without touching anything", async () => {
  render(<CloudAuthModal />);

  await userEvent.click(screen.getByRole("button", { name: "common.action.cancel" }));

  expect(useUIStore.getState().cloudAuthOpen).toBe(false);
  expect(h.authenticateServerAccount).not.toHaveBeenCalled();
  expect(h.addAccount).not.toHaveBeenCalled();
});
