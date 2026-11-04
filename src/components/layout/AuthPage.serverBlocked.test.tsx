// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  login: vi.fn(),
  authenticate: vi.fn(),
  addAccount: vi.fn(),
  createServerAccount: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  Trans: () => null,
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./LogoBadge", () => ({ default: () => null }));
vi.mock("@/services/account", () => ({
  createLocalAccountNoPassword: vi.fn(),
  createServerAccount: h.createServerAccount,
  authenticateServerAccount: h.authenticate,
  login: h.login,
}));
vi.mock("@/services/savedAccounts", () => ({ addAccount: h.addAccount }));
vi.mock("@/stores/notificationStore", () => ({ APP_SOURCE: { kind: "app" },
  useNotificationStore: (sel: (s: unknown) => unknown) => sel({ addToast: vi.fn() }),
}));
vi.mock("@/components/shared/VaultBackups", () => ({ VaultBackups: () => null }));
vi.mock("@/hooks/useSystemAuthPrompt", () => ({
  useSystemAuthPrompt: () => ({ available: false, checked: true, busy: false, outcome: null, prompt: vi.fn() }),
}));
vi.mock("@/services/vaultBinding", () => ({
  rebindAfterPassword: vi.fn(),
  unlockWithSystemAuth: vi.fn(),
}));

import { AccountAlreadyActiveError, ServerBlockedError } from "@/services/accountErrors";
import AuthPage from "./AuthPage";

beforeEach(() => {
  Object.values(h).forEach((f) => f.mockReset());
});
afterEach(cleanup);

test("a blocked password unlock moves to add-account sign-in with no wipe offer", async () => {
  h.login.mockRejectedValue(new ServerBlockedError());
  const { container } = render(<AuthPage isLocked onReady={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder"), { target: { value: "pw" } });
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(screen.getByPlaceholderText("layout.auth.emailPlaceholder")).toBeTruthy());
  expect(screen.queryByText("layout.auth.resetVault")).toBeNull();
  expect(screen.queryByText("layout.auth.back")).toBeNull();
});

test("cloud-only sign-in adds a new account instead of overwriting the session", async () => {
  const session = { account_id: "n" };
  h.authenticate.mockResolvedValue(session);
  h.addAccount.mockResolvedValue(undefined);
  const onReady = vi.fn();
  const { container } = render(<AuthPage isLocked={false} cloudOnly onReady={onReady} />);
  fireEvent.change(screen.getByPlaceholderText("layout.auth.emailPlaceholder"), { target: { value: "a@b.c" } });
  fireEvent.change(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder"), { target: { value: "pw" } });
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(h.addAccount).toHaveBeenCalledWith(session, undefined));
  expect(h.authenticate.mock.calls[0][0]).toBe("signin");
  expect(onReady).not.toHaveBeenCalled();
  expect(h.login).not.toHaveBeenCalled();
  expect(h.createServerAccount).not.toHaveBeenCalled();
});

test("cloud-only register adds a new account", async () => {
  h.authenticate.mockResolvedValue({ account_id: "n" });
  h.addAccount.mockResolvedValue(undefined);
  const { container } = render(<AuthPage isLocked={false} cloudOnly onReady={vi.fn()} />);
  fireEvent.click(screen.getByText("layout.auth.createAccount"));
  fireEvent.change(screen.getByPlaceholderText("layout.auth.emailPlaceholder"), { target: { value: "a@b.c" } });
  fireEvent.change(screen.getByPlaceholderText("layout.auth.masterPasswordMinPlaceholder"), { target: { value: "password1" } });
  fireEvent.change(screen.getByPlaceholderText("layout.auth.confirmPasswordPlaceholder"), { target: { value: "password1" } });
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(h.addAccount).toHaveBeenCalled());
  expect(h.authenticate.mock.calls[0][0]).toBe("register");
  expect(h.createServerAccount).not.toHaveBeenCalled();
});

async function unlockBlockedThenSignIn() {
  h.login.mockRejectedValue(new ServerBlockedError("proven-pw"));
  h.authenticate.mockResolvedValue({ account_id: "n" });
  const { container } = render(<AuthPage isLocked onReady={vi.fn()} />);
  fireEvent.change(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder"), { target: { value: "proven-pw" } });
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(screen.getByPlaceholderText("layout.auth.emailPlaceholder")).toBeTruthy());
  fireEvent.change(screen.getByPlaceholderText("layout.auth.emailPlaceholder"), { target: { value: "a@b.c" } });
  fireEvent.change(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder"), { target: { value: "new-pw" } });
  fireEvent.submit(container.querySelector("form")!);
  await waitFor(() => expect(h.addAccount).toHaveBeenCalled());
}

test("the password proven on the blocked lock screen goes to the add, not the keychain", async () => {
  h.addAccount.mockResolvedValue(undefined);
  await unlockBlockedThenSignIn();
  expect(h.addAccount).toHaveBeenCalledWith({ account_id: "n" }, "proven-pw");
});

test("adding the account already signed in shows why nothing happened", async () => {
  h.addAccount.mockRejectedValue(new AccountAlreadyActiveError());
  await unlockBlockedThenSignIn();
  await waitFor(() => expect(screen.getByText("common.error.accountAlreadyActive")).toBeTruthy());
});
