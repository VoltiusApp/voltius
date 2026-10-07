import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  platform: "macos" as string | null,
  finishLogin: null as null | ((outcome: "declined") => void),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/utils/platform", () => ({ usePlatform: () => h.platform }));
vi.mock("@/services/account", () => ({
  autoLogin: vi.fn(() => new Promise((resolve) => { h.finishLogin = resolve; })),
  getAppLock: vi.fn(async () => null),
  setAppLock: vi.fn(async () => {}),
  isServerMode: vi.fn(async () => false),
}));
vi.mock("@/services/vault", () => ({ getVaultStatus: vi.fn(async () => ({ exists: true })) }));
vi.mock("./AuthPage", () => ({ default: () => <div>auth-page</div> }));
vi.mock("./LogoBadge", () => ({ default: () => <div /> }));

import SplashScreen from "./SplashScreen";

const HINT = "layout.splash.keychainHint";

beforeEach(() => {
  vi.useFakeTimers();
  h.platform = "macos";
  h.finishLogin = null;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

test("explains the keychain prompt when the macOS vault check stalls", async () => {
  render(<SplashScreen onReady={() => {}} />);
  await advance(2000);
  expect(screen.queryByText(HINT)).toBeNull();
  await advance(3000);
  expect(screen.getByText(HINT)).toBeTruthy();
});

test("never shows the hint off macOS", async () => {
  h.platform = "linux";
  render(<SplashScreen onReady={() => {}} />);
  await advance(1000);
  await advance(10_000);
  expect(screen.queryByText(HINT)).toBeNull();
});

test("hides the hint once the vault check finishes", async () => {
  render(<SplashScreen onReady={() => {}} />);
  await advance(1000);
  await advance(3000);
  expect(screen.getByText(HINT)).toBeTruthy();
  await act(async () => { h.finishLogin?.("declined"); });
  await advance(100);
  expect(screen.queryByText(HINT)).toBeNull();
});
