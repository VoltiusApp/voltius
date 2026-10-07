import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  lock: null as string | null,
  autoLogin: vi.fn(async () => "ok"),
  systemAuthUnlock: false,
  available: true,
  authProps: null as null | { isLocked: boolean; systemAuth?: boolean },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/utils/platform", () => ({ usePlatform: () => "linux" }));
vi.mock("@/services/account", () => ({
  autoLogin: h.autoLogin,
  getAppLock: vi.fn(async () => h.lock),
  setAppLock: vi.fn(async () => {}),
  isServerMode: vi.fn(async () => false),
}));
vi.mock("@/services/appLock", () => ({ systemAuthAvailable: vi.fn(async () => h.available) }));
vi.mock("@/stores/securityStore", () => ({
  useSecurityStore: { getState: () => ({ systemAuthUnlock: h.systemAuthUnlock }) },
}));
vi.mock("@/services/vault", () => ({ getVaultStatus: vi.fn(async () => ({ exists: true })) }));
vi.mock("./AuthPage", () => ({
  default: (p: { isLocked: boolean; systemAuth?: boolean }) => { h.authProps = p; return <div>auth-page</div>; },
}));
vi.mock("./LogoBadge", () => ({ default: () => <div /> }));

import SplashScreen from "./SplashScreen";

beforeEach(() => {
  vi.useFakeTimers();
  h.lock = null;
  h.systemAuthUnlock = false;
  h.authProps = null;
  h.autoLogin.mockClear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

test("a vault lock that survived a restart goes to the unlock page, never auto-login", async () => {
  h.lock = "vault";
  render(<SplashScreen onReady={() => {}} />);
  await advance(2000);
  expect(screen.getByText("auth-page")).toBeTruthy();
  expect(h.autoLogin).not.toHaveBeenCalled();
  expect(h.authProps).toMatchObject({ isLocked: true, systemAuth: false });
});

test("the unlock page offers system auth when it was on at lock time", async () => {
  h.lock = "vault";
  h.systemAuthUnlock = true;
  render(<SplashScreen onReady={() => {}} />);
  await advance(2000);
  expect(h.authProps).toMatchObject({ isLocked: true, systemAuth: true });
});

test("a screen lock that survived a restart is up before the shell shows", async () => {
  h.lock = "screen";
  const { useAppLockStore } = await import("@/stores/appLockStore");
  let lockedAtReady: string | null = null;
  render(<SplashScreen onReady={() => { lockedAtReady = useAppLockStore.getState().kind; }} />);
  await advance(10_000);
  expect(h.autoLogin).toHaveBeenCalled();
  expect(lockedAtReady).toBe("screen");
});
