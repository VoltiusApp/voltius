import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({
  verify: vi.fn(async (_reason: string) => "ok" as string),
  autoLogin: vi.fn(async () => "ok" as string),
  onReady: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
  Trans: () => null,
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("./LogoBadge", () => ({ default: () => null }));
vi.mock("@/services/appLock", () => ({ systemAuthAvailable: async () => true, systemAuthVerify: h.verify }));
vi.mock("@/services/account", () => ({
  autoLogin: h.autoLogin,
  login: vi.fn(),
  createLocalAccountNoPassword: vi.fn(),
  createServerAccount: vi.fn(),
}));
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: (sel: (s: unknown) => unknown) => sel({ addToast: vi.fn() }),
}));
vi.mock("@/utils/platform", () => ({ usePlatform: () => "windows" }));
vi.mock("@/components/shared/VaultBackups", () => ({ VaultBackups: () => null }));

import AuthPage from "./AuthPage";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  h.verify.mockResolvedValue("ok");
  h.autoLogin.mockResolvedValue("ok");
});
afterEach(() => cleanup());
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

test("without system auth the locked page is unchanged: password only, no prompt", async () => {
  render(<AuthPage isLocked onReady={h.onReady} />);
  await flush();
  expect(h.verify).not.toHaveBeenCalled();
  expect(screen.queryByText("layout.appLock.unlockWith")).toBeNull();
  expect(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder")).toBeTruthy();
});

test("with system auth it prompts once and a success reopens the vault from the keychain", async () => {
  render(<AuthPage isLocked systemAuth onReady={h.onReady} />);
  await flush();
  await flush();
  await flush();
  expect(h.verify).toHaveBeenCalledTimes(1);
  expect(h.autoLogin).toHaveBeenCalled();
  expect(h.onReady).toHaveBeenCalled();
});

test("a cancelled prompt leaves the password form and a Try again button", async () => {
  h.verify.mockResolvedValue("cancelled");
  render(<AuthPage isLocked systemAuth onReady={h.onReady} />);
  await flush();
  await flush();
  expect(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder")).toBeTruthy();
  fireEvent.click(screen.getByText("layout.appLock.tryAgain"));
  await flush();
  expect(h.verify).toHaveBeenCalledTimes(2);
});

test("a keychain entry that no longer opens the vault falls back to the password with an error", async () => {
  h.autoLogin.mockResolvedValue("declined");
  render(<AuthPage isLocked systemAuth onReady={h.onReady} />);
  await flush();
  await flush();
  await flush();
  expect(h.onReady).not.toHaveBeenCalled();
  expect(screen.getByText("layout.appLock.keychainEmpty")).toBeTruthy();
});
