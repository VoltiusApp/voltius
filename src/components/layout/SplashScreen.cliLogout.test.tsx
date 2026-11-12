import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({
  marker: [] as string[],
  calls: [] as string[],
  clearFails: false,
  reload: vi.fn(() => {
    h.calls.push("reload");
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/utils/platform", () => ({ isMobilePlatform: () => false, usePlatform: () => "linux" }));
vi.mock("@/lib/invoke", async (orig) => ({
  ...(await orig<typeof import("@/lib/invoke")>()),
  invoke: vi.fn(async (cmd: string) => {
    if (cmd === "cli_logout_marker_take") {
      h.calls.push("take");
      return h.marker;
    }
    throw new Error(`no backend for ${cmd}`);
  }),
}));
vi.mock("@/services/account", () => ({
  announceWithdrawnInvitations: vi.fn(async () => {}),
  autoLogin: vi.fn(async () => {
    h.calls.push("autoLogin");
    return "declined";
  }),
  getAppLock: vi.fn(async () => null),
  setAppLock: vi.fn(async () => {}),
  isServerMode: vi.fn(async () => false),
  getAccountMode: vi.fn(async () => null),
  getAccountId: vi.fn(async () => null),
}));
vi.mock("@/services/appLock", () => ({ systemAuthAvailable: async () => false, lockOnLaunchIfIdle: async () => null }));
vi.mock("@/services/vault", () => ({
  getVaultStatus: vi.fn(async () => ({ exists: false })),
  clearAccountUiState: vi.fn(async () => {
    h.calls.push("clearAccountUiState");
    if (h.clearFails) throw new Error("storage refused");
  }),
}));
vi.mock("@/stores/persistedAccountUiState", async (orig) => ({
  ...(await orig<typeof import("@/stores/persistedAccountUiState")>()),
  dropAccountUiState: vi.fn((id: string) => {
    h.calls.push(`dropAccountUiState ${id}`);
  }),
}));
vi.mock("@/services/savedAccounts", () => ({ adoptServerMove: vi.fn(async () => {}), saveCurrentAccount: vi.fn(async () => {}) }));
vi.mock("./AuthPage", () => ({ default: () => <div>home</div> }));
vi.mock("./LogoBadge", () => ({ default: () => <div /> }));

import SplashScreen from "./SplashScreen";

beforeEach(() => {
  Object.defineProperty(window, "location", { value: { reload: h.reload }, writable: true, configurable: true });
});

afterEach(() => {
  cleanup();
  h.marker = [];
  h.calls = [];
  h.clearFails = false;
});

test("splash consumes the logout marker before autoLogin and clears account UI state", async () => {
  h.marker = ["acc-1", "acc-2"];
  render(<SplashScreen onReady={() => {}} />);
  await vi.waitFor(() => expect(h.calls).toContain("reload"));
  expect(h.calls).toEqual([
    "take",
    "clearAccountUiState",
    "dropAccountUiState acc-1",
    "dropAccountUiState acc-2",
    "reload",
  ]);
  await new Promise((r) => setTimeout(r, 50));
  expect(h.calls).not.toContain("autoLogin");
});

test("no marker → nothing cleared", async () => {
  render(<SplashScreen onReady={() => {}} />);
  expect(await screen.findByText("home")).toBeTruthy();
  expect(h.calls).toEqual(["take", "autoLogin"]);
});

test("a cleanup that throws still reloads instead of carrying on with the old account", async () => {
  h.marker = ["acc-1"];
  h.clearFails = true;
  render(<SplashScreen onReady={() => {}} />);
  await vi.waitFor(() => expect(h.calls).toContain("reload"));
  expect(h.calls).toEqual(["take", "clearAccountUiState", "reload"]);
  await new Promise((r) => setTimeout(r, 50));
  expect(h.calls).not.toContain("autoLogin");
});
