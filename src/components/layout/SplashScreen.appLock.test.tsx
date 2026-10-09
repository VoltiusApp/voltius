import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  lock: null as string | null,
  autoLogin: vi.fn(async () => "ok"),
  systemAuthUnlock: false,
  available: true,
  exists: true,
  mode: null as string | null,
  launchLock: null as string | null,
  secret: "plain",
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
  isServerMode: vi.fn(async () => h.mode === "server"),
  getAccountMode: vi.fn(async () => h.mode),
}));
vi.mock("@/services/appLock", () => ({
  systemAuthAvailable: vi.fn(async () => h.available),
  lockOnLaunchIfIdle: vi.fn(async () => h.launchLock),
}));
vi.mock("@/services/vaultSecret", () => ({ secretState: vi.fn(async () => h.secret) }));
vi.mock("@/stores/securityStore", () => ({
  useSecurityStore: { getState: () => ({ systemAuthUnlock: h.systemAuthUnlock }) },
}));
vi.mock("@/services/vault", () => ({ getVaultStatus: vi.fn(async () => ({ exists: h.exists })) }));
vi.mock("./AuthPage", () => ({
  default: (p: { isLocked: boolean; systemAuth?: boolean }) => { h.authProps = p; return <div>auth-page</div>; },
}));
vi.mock("./LogoBadge", () => ({ default: () => <div /> }));

import SplashScreen from "./SplashScreen";

beforeEach(() => {
  vi.useFakeTimers();
  h.lock = null;
  h.systemAuthUnlock = false;
  h.exists = true;
  h.mode = null;
  h.launchLock = null;
  h.secret = "plain";
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

test("a vault-locked cloud account with no vault file yet still gets the unlock page", async () => {
  h.lock = "vault";
  h.exists = false;
  h.mode = "server";
  render(<SplashScreen onReady={() => {}} />);
  await advance(2000);
  expect(h.authProps).toMatchObject({ isLocked: true });
});

test("a vault lock with no vault file and no cloud account is a first launch", async () => {
  h.lock = "vault";
  h.exists = false;
  render(<SplashScreen onReady={() => {}} />);
  await advance(2000);
  expect(h.authProps).toMatchObject({ isLocked: false });
});

test("a vault-locked local account that never wrote a secret gets the unlock page, not onboarding", async () => {
  h.lock = "vault";
  h.exists = false;
  h.mode = "local";
  render(<SplashScreen onReady={() => {}} />);
  await advance(2000);
  expect(h.authProps).toMatchObject({ isLocked: true });
});

test("a launch past the auto-lock timeout with Lock vault goes to the unlock page, never auto-login", async () => {
  h.launchLock = "vault";
  render(<SplashScreen onReady={() => {}} />);
  await advance(2000);
  expect(h.autoLogin).not.toHaveBeenCalled();
  expect(h.authProps).toMatchObject({ isLocked: true });
});

test("a launch past the auto-lock timeout with Lock screen still opens the vault behind the lock", async () => {
  h.launchLock = "screen";
  render(<SplashScreen onReady={() => {}} />);
  await advance(10_000);
  expect(h.autoLogin).toHaveBeenCalled();
  expect(h.authProps).toBeNull();
});

test("sealed launch goes to the locked screen without a vault file", async () => {
  h.autoLogin.mockResolvedValueOnce("sealed");
  h.exists = false;
  render(<SplashScreen onReady={() => {}} />);
  await advance(2000);
  expect(h.authProps).toMatchObject({ isLocked: true, systemAuth: true });
});

test("a vault lock over a sealed secret offers system auth even with the setting off", async () => {
  h.lock = "vault";
  h.secret = "sealed";
  render(<SplashScreen onReady={() => {}} />);
  await advance(2000);
  expect(h.authProps).toMatchObject({ isLocked: true, systemAuth: true });
});

test("a declined login on a cloud account with no vault file yet still gets the unlock page", async () => {
  h.autoLogin.mockResolvedValueOnce("declined");
  h.exists = false;
  h.mode = "server";
  render(<SplashScreen onReady={() => {}} />);
  await advance(2000);
  expect(h.authProps).toMatchObject({ isLocked: true });
});
