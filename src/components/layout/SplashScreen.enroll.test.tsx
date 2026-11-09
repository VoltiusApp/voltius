import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const h = vi.hoisted(() => ({
  machine: null as null | { serverUrl: string; id: string; secret: string },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/utils/platform", () => ({ isMobilePlatform: () => false, usePlatform: () => "linux" }));
vi.mock("@/services/account", () => ({
  autoLogin: vi.fn(async () => "declined"),
  getAppLock: vi.fn(async () => null),
  setAppLock: vi.fn(async () => {}),
  isServerMode: vi.fn(async () => false),
  getAccountMode: vi.fn(async () => null),
  getAccountId: vi.fn(async () => null),
}));
vi.mock("@/services/appLock", () => ({ systemAuthAvailable: async () => false, lockOnLaunchIfIdle: async () => null }));
vi.mock("@/services/vault", () => ({ getVaultStatus: vi.fn(async () => ({ exists: false })) }));
vi.mock("@/services/savedAccounts", () => ({ adoptServerMove: vi.fn(async () => {}), saveCurrentAccount: vi.fn(async () => {}) }));
vi.mock("@/services/enrollment/machineToken", () => ({ machineEnrollmentToken: () => h.machine }));
vi.mock("./AuthPage", () => ({
  default: (p: { enrollTarget?: { source: string; token: { id: string } } }) => (
    <div>{p.enrollTarget ? `enroll:${p.enrollTarget.source}:${p.enrollTarget.token.id}` : "home"}</div>
  ),
}));
vi.mock("./LogoBadge", () => ({ default: () => <div /> }));

import SplashScreen from "./SplashScreen";
import { useDeepLinkStore } from "@/stores/deepLinkStore";
import { buildEnrollmentToken } from "@/services/enrollment/enrollmentToken";

const SECRET = "s".repeat(43);
const LINK_ID = "11111111111111111111111111111111";
const MACHINE_ID = "22222222222222222222222222222222";

afterEach(() => {
  cleanup();
  h.machine = null;
  useDeepLinkStore.setState({ ready: false, queue: [], prompt: null });
});

test("first launch prefers queued link token over machine token", async () => {
  h.machine = { serverUrl: "https://voltius.acme.com", id: MACHINE_ID, secret: SECRET };
  const link = { route: "enroll" as const, token: buildEnrollmentToken("https://voltius.acme.com", LINK_ID, SECRET) };
  useDeepLinkStore.setState({ ready: false, queue: [link], prompt: null });
  render(<SplashScreen onReady={() => {}} />);
  expect(await screen.findByText(`enroll:link:${LINK_ID}`)).toBeTruthy();
  expect(useDeepLinkStore.getState().queue).toEqual([]);
});

test("first launch falls back to the machine token", async () => {
  h.machine = { serverUrl: "https://voltius.acme.com", id: MACHINE_ID, secret: SECRET };
  render(<SplashScreen onReady={() => {}} />);
  expect(await screen.findByText(`enroll:machine:${MACHINE_ID}`)).toBeTruthy();
});

test("first launch without any token shows the generic home", async () => {
  render(<SplashScreen onReady={() => {}} />);
  expect(await screen.findByText("home")).toBeTruthy();
});
