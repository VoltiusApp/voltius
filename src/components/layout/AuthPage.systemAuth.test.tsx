import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({
  unlock: vi.fn(async (_reason: string) => "ok" as string),
  rebind: vi.fn(async (_password: string, _reason: string) => undefined),
  login: vi.fn(async (_password: string) => undefined),
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
vi.mock("@/services/appLock", () => ({ systemAuthAvailable: async () => true }));
vi.mock("@/services/vaultBinding", () => ({ unlockWithSystemAuth: h.unlock, rebindAfterPassword: h.rebind }));
vi.mock("@/services/account", () => ({
  login: h.login,
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
  h.unlock.mockResolvedValue("ok");
});
afterEach(() => cleanup());
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

test("without system auth the locked page is unchanged: password only, no prompt", async () => {
  render(<AuthPage isLocked onReady={h.onReady} />);
  await flush();
  expect(h.unlock).not.toHaveBeenCalled();
  expect(screen.queryByText("layout.appLock.unlockWith")).toBeNull();
  expect(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder")).toBeTruthy();
});

test("with system auth it prompts once and a success opens the app", async () => {
  render(<AuthPage isLocked systemAuth onReady={h.onReady} />);
  await flush();
  await flush();
  await flush();
  expect(h.unlock).toHaveBeenCalledTimes(1);
  expect(h.onReady).toHaveBeenCalled();
});

test("a cancelled prompt leaves the password form and a Try again button", async () => {
  h.unlock.mockResolvedValue("cancelled");
  render(<AuthPage isLocked systemAuth onReady={h.onReady} />);
  await flush();
  await flush();
  expect(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder")).toBeTruthy();
  fireEvent.click(screen.getByText("layout.appLock.tryAgain"));
  await flush();
  expect(h.unlock).toHaveBeenCalledTimes(2);
});

test("a keychain entry that no longer opens the vault falls back to the password with an error", async () => {
  h.unlock.mockResolvedValue("declined");
  render(<AuthPage isLocked systemAuth onReady={h.onReady} />);
  await flush();
  await flush();
  await flush();
  expect(h.onReady).not.toHaveBeenCalled();
  expect(screen.getByText("layout.appLock.keychainEmpty")).toBeTruthy();
});

test("a lost device binding asks for the password and binds again after it", async () => {
  h.unlock.mockResolvedValue("invalidated");
  render(<AuthPage isLocked systemAuth onReady={h.onReady} />);
  await flush();
  await flush();
  await flush();
  expect(screen.getByText("layout.appLock.bindingLost")).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder"), { target: { value: "pw" } });
  fireEvent.click(screen.getByText("layout.auth.unlock"));
  await flush();
  await flush();
  expect(h.login).toHaveBeenCalledWith("pw");
  expect(h.rebind).toHaveBeenCalledWith("pw", "layout.appLock.sealReason");
  expect(h.onReady).toHaveBeenCalled();
});

test("a plain password unlock does not bind", async () => {
  render(<AuthPage isLocked onReady={h.onReady} />);
  await flush();
  fireEvent.change(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder"), { target: { value: "pw" } });
  fireEvent.click(screen.getByText("layout.auth.unlock"));
  await flush();
  await flush();
  expect(h.login).toHaveBeenCalledWith("pw");
  expect(h.rebind).not.toHaveBeenCalled();
});
