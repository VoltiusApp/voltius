import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";

const h = vi.hoisted(() => ({
  mode: "local" as string | null,
  systemAuthAvailable: true,
  lockApp: vi.fn(async () => {}),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
  Trans: () => null,
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@/services/vault", () => ({
  resetVault: vi.fn(async () => {}),
  listVaultBackups: vi.fn(async () => []),
  restoreVaultBackup: vi.fn(async () => null),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: () => ({
    tier: "free", trialEndsAt: null, isTrialActive: false, isPro: false, isTeams: false, isBusiness: false,
    usedSeats: null, totalSeats: null, subscriptionStatus: null, subscriptionCancelled: false, renewsAt: null, endsAt: null,
  }),
}));
vi.mock("@/utils/billing", () => ({ openPortal: vi.fn() }));
vi.mock("@/utils/platform", async () => ({
  ...(await vi.importActual<typeof import("@/utils/platform")>("@/utils/platform")),
  usePlatform: () => "linux",
  useIsAndroid: () => false,
}));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn(async () => {}) }));
vi.mock("./EditEmailModal", () => ({ default: () => null }));
vi.mock("./ChangeMasterPasswordModal", () => ({ default: () => null }));
vi.mock("@/services/appLock", () => ({
  lockApp: h.lockApp,
  systemAuthAvailable: async () => h.systemAuthAvailable,
}));
vi.mock("@/services/account", async () => {
  const actual = await vi.importActual<typeof import("@/services/account")>("@/services/account");
  return {
    ...actual,
    getAccountMode: vi.fn(async () => h.mode),
    getCurrentUserEmail: vi.fn(async () => null),
    getMe: vi.fn(async () => null),
    setMasterPassword: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    lockVaultSession: vi.fn(async () => {}),
  };
});
vi.mock("@/services/teamService", () => ({
  claimHandle: vi.fn(),
  updateInvitePreferences: vi.fn(),
  HandleClaimError: class extends Error {},
}));

const { default: AccountSection } = await import("./AccountSection");
const { useSecurityStore } = await import("@/stores/securityStore");

const AUTO = "settings.account.sessionSecurity.autoLockLabel";
const ACTION = "settings.account.sessionSecurity.lockAction.label";
const TOGGLE = "settings.account.sessionSecurity.systemAuth.toggle";

beforeEach(() => {
  h.mode = "local";
  h.systemAuthAvailable = true;
  useSecurityStore.setState({ sessionTimeoutMinutes: null, lockAction: "vault", systemAuthUnlock: false });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

async function renderSection() {
  render(<AccountSection />);
  await flush();
  await flush();
}

test("defaults show Never, Lock vault and system auth off", async () => {
  await renderSection();
  expect(screen.getByRole("button", { name: AUTO }).textContent).toContain("settings.account.sessionSecurity.timeout.never");
  expect(screen.getByRole("button", { name: ACTION }).textContent).toContain("settings.account.sessionSecurity.lockAction.vault");
  expect(screen.getByRole("switch", { name: TOGGLE }).getAttribute("aria-checked")).toBe("false");
});

test("the system-auth toggle is disabled with a reason when the device has no provider", async () => {
  h.systemAuthAvailable = false;
  await renderSection();
  expect((screen.getByRole("switch", { name: TOGGLE }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("settings.account.sessionSecurity.systemAuth.unavailable")).toBeTruthy();
});

test("turning system auth on stores it and shows the keychain disclosure", async () => {
  await renderSection();
  fireEvent.click(screen.getByRole("switch", { name: TOGGLE }));
  expect(useSecurityStore.getState().systemAuthUnlock).toBe(true);
  expect(screen.getByText("settings.account.sessionSecurity.systemAuth.disclosure")).toBeTruthy();
});

test("a no-password account is told why it cannot auto-lock until system auth is on", async () => {
  h.mode = "local-nopassword";
  await renderSection();
  expect(screen.getByText("settings.account.sessionSecurity.needsSystemAuth")).toBeTruthy();
  expect((screen.getByRole("button", { name: AUTO }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("button", { name: ACTION }).textContent).toContain("settings.account.sessionSecurity.lockAction.screen");
});

test("a no-password account with system auth can pick a timeout", async () => {
  h.mode = "local-nopassword";
  useSecurityStore.setState({ systemAuthUnlock: true });
  await renderSection();
  expect((screen.getByRole("button", { name: AUTO }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByText("settings.account.sessionSecurity.needsSystemAuth")).toBeNull();
});

test("Immediately with Lock vault warns that leaving closes sessions", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 0, lockAction: "vault" });
  await renderSection();
  expect(screen.getByText("settings.account.sessionSecurity.immediateVaultWarning")).toBeTruthy();
});

test("no warning once the action keeps sessions running", async () => {
  useSecurityStore.setState({ sessionTimeoutMinutes: 0, lockAction: "screen" });
  await renderSection();
  expect(screen.queryByText("settings.account.sessionSecurity.immediateVaultWarning")).toBeNull();
});

test("the manual Lock action goes through lockApp", async () => {
  await renderSection();
  fireEvent.click(screen.getByText("settings.account.lockVault.label"));
  expect(h.lockApp).toHaveBeenCalled();
});
