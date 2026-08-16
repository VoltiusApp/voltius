import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MeResponse } from "@/services/account";

const h = vi.hoisted(() => ({
  getMe: vi.fn(async (): Promise<MeResponse | null> => null),
  claimHandle: vi.fn(),
  updateInvitePreferences: vi.fn(async () => {}),
}));

class HandleClaimError extends Error {
  constructor(public status: number) {
    super(`handle claim failed: ${status}`);
  }
}

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));
vi.mock("@/services/vault", () => ({ resetVault: vi.fn(async () => {}) }));
vi.mock("@/stores/securityStore", () => ({
  useSecurityStore: (selector: (s: unknown) => unknown) =>
    selector({ sessionTimeoutMinutes: null, setSessionTimeoutMinutes: vi.fn() }),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: () => ({
    tier: "free", trialEndsAt: null, isTrialActive: false, isPro: false, isTeams: false, isBusiness: false,
    usedSeats: null, totalSeats: null, subscriptionStatus: null, subscriptionCancelled: false, renewsAt: null, endsAt: null,
  }),
}));
vi.mock("@/utils/billing", () => ({ openPortal: vi.fn() }));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn(async () => {}) }));
vi.mock("./EditEmailModal", () => ({ default: () => null }));
vi.mock("./ChangeMasterPasswordModal", () => ({ default: () => null }));
vi.mock("@/services/account", async () => {
  const actual = await vi.importActual<typeof import("@/services/account")>("@/services/account");
  return {
    ...actual,
    getAccountMode: vi.fn(async () => "server"),
    getCurrentUserEmail: vi.fn(async () => "ada@example.com"),
    getMe: h.getMe,
    setMasterPassword: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    lockVaultSession: vi.fn(async () => {}),
  };
});
vi.mock("@/services/teamService", () => ({
  claimHandle: h.claimHandle,
  updateInvitePreferences: h.updateInvitePreferences,
  HandleClaimError,
}));

const { default: AccountSection } = await import("./AccountSection");

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("a free but verified account is offered the claim control — no tier gate", async () => {
  h.getMe.mockResolvedValue({ handle: "swift-otter-4821", handle_is_custom: false, tier: "free", email_verified: true, allow_stranger_invites: true });
  render(<AccountSection />);
  expect(await screen.findByText("@swift-otter-4821")).toBeTruthy();
  const choose = screen.getByRole("button", { name: "settings.account.handle.choose" });
  expect(choose.hasAttribute("disabled")).toBe(false);
  expect(screen.getByText("settings.account.handle.chooseSub")).toBeTruthy();
  expect(screen.queryByText("settings.account.handle.unverified")).toBeNull();
});

test("an unverified account sees the control disabled with the reason, not hidden", async () => {
  h.getMe.mockResolvedValue({ handle: "swift-otter-4821", handle_is_custom: false, tier: "pro", email_verified: false, allow_stranger_invites: true });
  render(<AccountSection />);
  const choose = await screen.findByRole("button", { name: "settings.account.handle.choose" });
  expect(choose.hasAttribute("disabled")).toBe(true);
  expect(screen.getByText("settings.account.handle.unverified")).toBeTruthy();
});

test("the copy explains what a custom handle does rather than naming a tier", async () => {
  h.getMe.mockResolvedValue({ handle: "swift-otter-4821", handle_is_custom: false, tier: "free", email_verified: true, allow_stranger_invites: true });
  render(<AccountSection />);
  await screen.findByText("settings.account.handle.chooseSub");
  expect(screen.getByText("settings.account.handle.generatedNote")).toBeTruthy();
});

test("a verified account can claim and the taken case is explained, not swallowed", async () => {
  h.getMe.mockResolvedValue({ handle: "swift-otter-4821", handle_is_custom: false, tier: "free", email_verified: true, allow_stranger_invites: true });
  h.claimHandle.mockRejectedValue(new HandleClaimError(409));
  render(<AccountSection />);
  await userEvent.click(await screen.findByRole("button", { name: "settings.account.handle.choose" }));
  await userEvent.type(screen.getByRole("textbox", { name: /handle/i }), "kevin-p");
  await userEvent.click(screen.getByRole("button", { name: "settings.account.handle.save" }));
  expect(await screen.findByText("settings.account.handle.errorTaken")).toBeTruthy();
});

test("the stranger-invite toggle persists", async () => {
  h.getMe.mockResolvedValue({ handle: "h", handle_is_custom: false, tier: "pro", email_verified: true, allow_stranger_invites: true });
  render(<AccountSection />);
  await userEvent.click(await screen.findByRole("switch", { name: "settings.account.strangerInvites.label" }));
  expect(h.updateInvitePreferences).toHaveBeenCalledWith(false);
});

test("the stranger-invite toggle reverts on failure", async () => {
  h.getMe.mockResolvedValue({ handle: "h", handle_is_custom: false, tier: "pro", email_verified: true, allow_stranger_invites: true });
  h.updateInvitePreferences.mockRejectedValueOnce(new Error("network error"));
  render(<AccountSection />);
  const toggle = await screen.findByRole("switch", { name: "settings.account.strangerInvites.label" });
  await userEvent.click(toggle);
  await screen.findByText("network error");
  expect(toggle.getAttribute("aria-checked")).toBe("true");
});

test("distinct copy for each claim-failure status", async () => {
  h.getMe.mockResolvedValue({ handle: "h", handle_is_custom: false, tier: "pro", email_verified: true, allow_stranger_invites: true });
  const cases: [number, string][] = [
    [403, "settings.account.handle.errorEmailNotVerified"],
    [422, "settings.account.handle.errorInvalid"],
    [429, "settings.account.handle.errorCooldown"],
  ];
  for (const [status, key] of cases) {
    h.claimHandle.mockRejectedValueOnce(new HandleClaimError(status));
    render(<AccountSection />);
    await userEvent.click(await screen.findByRole("button", { name: "settings.account.handle.choose" }));
    await userEvent.type(screen.getByRole("textbox", { name: /handle/i }), "kevin-p");
    await userEvent.click(screen.getByRole("button", { name: "settings.account.handle.save" }));
    expect(await screen.findByText(key)).toBeTruthy();
    cleanup();
  }
});

test("a lapsed account can still rename its custom handle", async () => {
  h.getMe.mockResolvedValue({ handle: "kevin-p", handle_is_custom: true, tier: "free", email_verified: true, allow_stranger_invites: true });
  render(<AccountSection />);
  await screen.findByText("@kevin-p");
  const change = screen.getByRole("button", { name: "settings.account.handle.change" });
  expect(change.hasAttribute("disabled")).toBe(false);
});

test("no verify-your-email flash before /auth/me answers", async () => {
  let resolveMe!: (v: MeResponse) => void;
  h.getMe.mockReturnValue(new Promise<MeResponse>((resolve) => { resolveMe = resolve; }));
  render(<AccountSection />);
  // Wait for mode ("server") to resolve and the handle block to mount while
  // getMe (and so email_verified) is still pending — the exact window a
  // verified user would otherwise see the "verify your email" line flash in.
  await screen.findByText("settings.account.handle.title");
  expect(screen.queryByText("settings.account.handle.unverified")).toBeNull();
  expect(screen.queryByRole("button", { name: "settings.account.handle.choose" })).toBeNull();
  resolveMe({ handle: "swift-otter-4821", handle_is_custom: false, tier: "pro", email_verified: true, allow_stranger_invites: true });
  expect(await screen.findByRole("button", { name: "settings.account.handle.choose" })).toBeTruthy();
});

test("the stranger-invite toggle disables itself mid-flight so a second click can't race it", async () => {
  h.getMe.mockResolvedValue({ handle: "h", handle_is_custom: false, tier: "pro", email_verified: true, allow_stranger_invites: true });
  let resolveUpdate!: () => void;
  h.updateInvitePreferences.mockReturnValue(new Promise<void>((resolve) => { resolveUpdate = resolve; }));
  render(<AccountSection />);
  const toggle = await screen.findByRole("switch", { name: "settings.account.strangerInvites.label" });
  await userEvent.click(toggle);
  expect(toggle.hasAttribute("disabled")).toBe(true);
  resolveUpdate();
  await waitFor(() => expect(toggle.hasAttribute("disabled")).toBe(false));
});
