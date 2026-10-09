import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({
  available: true,
  verify: vi.fn(async (_reason: string) => "ok" as string),
  mode: "local" as string | null,
  correct: "pw",
  keychainBroken: false,
  resetVault: vi.fn(async () => undefined),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("./LogoBadge", () => ({ default: () => <div /> }));
vi.mock("@/services/appLock", () => ({
  systemAuthAvailable: async () => h.available,
}));
vi.mock("@/services/vaultBinding", () => ({ verifyForLockScreen: h.verify }));
vi.mock("@/services/account", () => ({
  getAccountMode: async () => h.mode,
  isCurrentMasterPassword: async (p: string) => {
    if (h.keychainBroken) throw new Error("keychain locked");
    return p === h.correct;
  },
  setAppLock: async () => undefined,
  getAppLock: async () => null,
}));
vi.mock("@/utils/platform", () => ({ usePlatform: () => "linux" }));
vi.mock("@/services/vault", () => ({ resetVault: h.resetVault }));

import AppLockOverlay from "./AppLockOverlay";
import { useAppLockStore } from "@/stores/appLockStore";
import { useSecurityStore } from "@/stores/securityStore";

const PASSWORD = "layout.auth.masterPasswordPlaceholder";

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  h.available = true;
  h.mode = "local";
  h.keychainBroken = false;
  h.verify.mockResolvedValue("ok");
  useAppLockStore.setState({ kind: "screen" });
  useSecurityStore.setState({ systemAuthUnlock: true });
  Object.defineProperty(window, "location", { value: { reload: vi.fn() }, writable: true, configurable: true });
});
afterEach(() => cleanup());

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

test("renders nothing when unlocked", () => {
  useAppLockStore.setState({ kind: null });
  render(<AppLockOverlay />);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("renders nothing for a vault lock, which the unlock page owns", () => {
  useAppLockStore.setState({ kind: "vault" });
  render(<AppLockOverlay />);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("prompts for system authentication exactly once and unlocks on success", async () => {
  render(<AppLockOverlay />);
  await flush();
  await flush();
  expect(h.verify).toHaveBeenCalledTimes(1);
  expect(useAppLockStore.getState().kind).toBeNull();
});

test("a cancelled prompt stays locked and offers Try again without re-prompting", async () => {
  h.verify.mockResolvedValue("cancelled");
  render(<AppLockOverlay />);
  await flush();
  await flush();
  expect(h.verify).toHaveBeenCalledTimes(1);
  expect(useAppLockStore.getState().kind).toBe("screen");
  fireEvent.click(screen.getByText("layout.appLock.tryAgain"));
  await flush();
  expect(h.verify).toHaveBeenCalledTimes(2);
});

test("without system auth no prompt is shown and the password field is focused", async () => {
  useSecurityStore.setState({ systemAuthUnlock: false });
  render(<AppLockOverlay />);
  await flush();
  expect(h.verify).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByPlaceholderText(PASSWORD));
});

test("the master password unlocks a password account", async () => {
  h.verify.mockResolvedValue("cancelled");
  render(<AppLockOverlay />);
  await flush();
  fireEvent.change(await screen.findByPlaceholderText(PASSWORD), { target: { value: "pw" } });
  fireEvent.submit(screen.getByPlaceholderText(PASSWORD).closest("form")!);
  await flush();
  expect(useAppLockStore.getState().kind).toBeNull();
});

test("a wrong master password shows an error and stays locked", async () => {
  h.verify.mockResolvedValue("cancelled");
  render(<AppLockOverlay />);
  await flush();
  fireEvent.change(await screen.findByPlaceholderText(PASSWORD), { target: { value: "bad" } });
  fireEvent.submit(screen.getByPlaceholderText(PASSWORD).closest("form")!);
  await flush();
  expect(screen.getByText("layout.appLock.wrongPassword")).toBeTruthy();
  expect(useAppLockStore.getState().kind).toBe("screen");
});

test("a password check that throws shows an error and frees the button", async () => {
  h.verify.mockResolvedValue("cancelled");
  h.keychainBroken = true;
  render(<AppLockOverlay />);
  await flush();
  fireEvent.change(await screen.findByPlaceholderText(PASSWORD), { target: { value: "pw" } });
  fireEvent.submit(screen.getByPlaceholderText(PASSWORD).closest("form")!);
  await flush();
  expect(screen.getByText("layout.appLock.systemAuthFailed")).toBeTruthy();
  expect((screen.getByRole("button", { name: "layout.auth.unlock" }) as HTMLButtonElement).disabled).toBe(false);
  expect(useAppLockStore.getState().kind).toBe("screen");
});

test("a no-password account with no system auth left is offered the reset, named for what it does", async () => {
  h.mode = "local-nopassword";
  h.available = false;
  render(<AppLockOverlay />);
  await flush();
  await flush();
  expect(screen.queryByPlaceholderText(PASSWORD)).toBeNull();
  fireEvent.click(screen.getByText("layout.auth.resetVault"));
  await flush();
  expect(h.resetVault).toHaveBeenCalled();
});

test("keys pressed outside the overlay never reach window listeners", async () => {
  h.verify.mockResolvedValue("cancelled");
  const shortcut = vi.fn();
  window.addEventListener("keydown", shortcut);
  render(<AppLockOverlay />);
  await flush();
  fireEvent.keyDown(document.body, { key: "t", ctrlKey: true });
  expect(shortcut).not.toHaveBeenCalled();
  window.removeEventListener("keydown", shortcut);
});

test("typing in the overlay's own password field still works", async () => {
  h.verify.mockResolvedValue("cancelled");
  render(<AppLockOverlay />);
  await flush();
  const field = await screen.findByPlaceholderText(PASSWORD);
  const seen = vi.fn();
  field.addEventListener("keydown", seen);
  fireEvent.keyDown(field, { key: "a" });
  expect(seen).toHaveBeenCalled();
});

test("paste outside the overlay is swallowed", async () => {
  h.verify.mockResolvedValue("cancelled");
  const onPaste = vi.fn();
  document.body.addEventListener("paste", onPaste);
  render(<AppLockOverlay />);
  await flush();
  fireEvent.paste(document.body);
  expect(onPaste).not.toHaveBeenCalled();
  document.body.removeEventListener("paste", onPaste);
});

test("the app root is inert while locked and restored on unlock", async () => {
  const root = document.createElement("div");
  root.id = "root";
  document.body.appendChild(root);
  render(<AppLockOverlay />, { container: document.body.appendChild(document.createElement("div")) });
  await flush();
  await flush();
  expect(root.hasAttribute("inert")).toBe(false);
  useAppLockStore.setState({ kind: "screen" });
  useSecurityStore.setState({ systemAuthUnlock: false });
  cleanup();
  render(<AppLockOverlay />);
  await flush();
  expect(root.hasAttribute("inert")).toBe(true);
  await act(async () => { await useAppLockStore.getState().unlock(); });
  expect(root.hasAttribute("inert")).toBe(false);
  root.remove();
});

test("a shortcut pressed on the overlay's own button reaches no app handler", async () => {
  h.verify.mockResolvedValue("cancelled");
  const pluginCapture = vi.fn();
  const appShortcut = vi.fn();
  document.addEventListener("keydown", pluginCapture, true);
  window.addEventListener("keydown", appShortcut);
  render(<AppLockOverlay />);
  await flush();
  await flush();
  fireEvent.keyDown(screen.getByText("layout.appLock.tryAgain"), { key: "w", ctrlKey: true });
  expect(pluginCapture).not.toHaveBeenCalled();
  expect(appShortcut).not.toHaveBeenCalled();
  document.removeEventListener("keydown", pluginCapture, true);
  window.removeEventListener("keydown", appShortcut);
});

test("Enter on the overlay does not confirm a modal left open behind it", async () => {
  h.verify.mockResolvedValue("cancelled");
  const modalEnter = vi.fn();
  document.addEventListener("keydown", modalEnter);
  render(<AppLockOverlay />);
  await flush();
  fireEvent.keyDown(await screen.findByPlaceholderText(PASSWORD), { key: "Enter" });
  expect(modalEnter).not.toHaveBeenCalled();
  document.removeEventListener("keydown", modalEnter);
});

test("pasting into the password field is not blocked", async () => {
  h.verify.mockResolvedValue("cancelled");
  render(<AppLockOverlay />);
  await flush();
  const field = await screen.findByPlaceholderText(PASSWORD);
  const allowed = fireEvent.keyDown(field, { key: "v", ctrlKey: true });
  expect(allowed).toBe(true);
});

test("other portals on the page are inert while locked", async () => {
  useSecurityStore.setState({ systemAuthUnlock: false });
  const stray = document.createElement("div");
  document.body.appendChild(stray);
  render(<AppLockOverlay />);
  await flush();
  expect(stray.hasAttribute("inert")).toBe(true);
  await act(async () => { await useAppLockStore.getState().unlock(); });
  expect(stray.hasAttribute("inert")).toBe(false);
  stray.remove();
});

test("a function key on the overlay reaches no plugin binding", async () => {
  h.verify.mockResolvedValue("cancelled");
  const pluginCapture = vi.fn();
  document.addEventListener("keydown", pluginCapture, true);
  render(<AppLockOverlay />);
  await flush();
  fireEvent.keyDown(await screen.findByPlaceholderText(PASSWORD), { key: "F5" });
  expect(pluginCapture).not.toHaveBeenCalled();
  document.removeEventListener("keydown", pluginCapture, true);
});
