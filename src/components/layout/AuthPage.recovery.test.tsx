import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./LogoBadge", () => ({ default: () => null }));
vi.mock("@/services/account", () => ({
  createLocalAccountNoPassword: vi.fn(),
  createServerAccount: vi.fn(),
  login: vi.fn(),
}));
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: (sel: (s: unknown) => unknown) => sel({ addToast: vi.fn() }),
}));
vi.mock("@/components/shared/VaultBackups", () => ({
  VaultBackups: () => <div data-testid="vault-backups" />,
}));

import AuthPage from "./AuthPage";

beforeEach(cleanup);

// The vault could not be opened before the user ever saw a screen, so the app
// must land on recovery rather than a password prompt.
test("starts in recovery when the vault was already found unreadable", () => {
  render(<AuthPage isLocked vaultUnreadable onReady={vi.fn()} />);

  expect(screen.getByText("layout.auth.vaultUnreadableTitle")).toBeTruthy();
  expect(screen.getByTestId("vault-backups")).toBeTruthy();
  expect(screen.queryByPlaceholderText("layout.auth.masterPasswordPlaceholder")).toBeNull();
});

// This account keeps its key in the OS keychain: there is no other password to
// try, and the cloud copy the normal wording offers does not exist either.
test("a no-password account is not offered another password attempt", () => {
  render(<AuthPage isLocked vaultUnreadable onReady={vi.fn()} />);

  expect(screen.queryByText("layout.auth.vaultUnreadableRetry")).toBeNull();
  expect(screen.getByText("layout.auth.vaultUnreadableBodyNoPassword")).toBeTruthy();
  expect(screen.getByText("layout.auth.vaultSetAsideLocal")).toBeTruthy();
});

test("without the flag the locked account still gets the password prompt", () => {
  render(<AuthPage isLocked onReady={vi.fn()} />);

  expect(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder")).toBeTruthy();
  expect(screen.queryByText("layout.auth.vaultUnreadableTitle")).toBeNull();
});
