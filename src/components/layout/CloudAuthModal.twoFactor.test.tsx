import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const h = vi.hoisted(() => ({
  login: vi.fn(),
  signInToCloud: vi.fn(),
  syncNow: vi.fn(async () => {}),
  syncOnLoginReplace: vi.fn(async () => {}),
  startSessionSync: vi.fn(),
  openPasskey: vi.fn(),
  passkeyRoundTrip: vi.fn(),
  cancelPasskeyRoundTrip: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/account", () => ({
  authenticateServerAccount: vi.fn(),
  getAccountMode: vi.fn(async () => "server"),
  getCurrentUserEmail: vi.fn(async () => "me@x.io"),
  linkToCloud: vi.fn(),
  login: h.login,
  setMasterPassword: vi.fn(),
  signInToCloud: h.signInToCloud,
}));
vi.mock("@/services/savedAccounts", () => ({ addAccount: vi.fn() }));
vi.mock("@/services/passkeyRoundTrip", () => {
  class PasskeyCancelledError extends Error {}
  return {
    PasskeyCancelledError,
    passkeyRoundTrip: h.passkeyRoundTrip,
    cancelPasskeyRoundTrip: h.cancelPasskeyRoundTrip,
  };
});
vi.mock("@/services/lanSync", () => ({ startSessionSync: h.startSessionSync }));
vi.mock("@/services/sync", () => ({
  syncNow: h.syncNow,
  syncOnLogin: vi.fn(async () => {}),
  syncOnLoginReplace: h.syncOnLoginReplace,
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: (sel: (s: unknown) => unknown) => sel({ load: vi.fn(async () => {}) }),
}));

import CloudAuthModal from "./CloudAuthModal";
import { useUIStore } from "@/stores/uiStore";
import { TwoFactorRequiredError, type TwoFactorMethod, type TwoFactorProof } from "@/services/twoFactorProof";

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const submit = () => userEvent.click(document.querySelector<HTMLButtonElement>('button[type="submit"]')!);
const type = (placeholder: string, value: string) =>
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });

type Complete = (proof: TwoFactorProof) => Promise<unknown>;

function asksForCode(complete: Complete, methods: TwoFactorMethod[] = ["totp", "recovery"]) {
  return new TwoFactorRequiredError(methods, complete, h.openPasskey);
}

test("a sign-in that needs a code shows the code step and finishes from it", async () => {
  const complete = vi.fn<Complete>(async () => {});
  h.signInToCloud.mockRejectedValue(asksForCode(complete));
  useUIStore.getState().openCloudAuth("signin", "link");
  render(<CloudAuthModal />);

  type("layout.auth.emailPlaceholder", "a@x.io");
  type("layout.auth.masterPasswordPlaceholder", "pw");
  await submit();

  const code = await screen.findByPlaceholderText("layout.twoFactor.codePlaceholder");
  expect(screen.queryByPlaceholderText("layout.auth.masterPasswordPlaceholder")).toBeNull();
  expect(h.syncOnLoginReplace).not.toHaveBeenCalled();
  expect(useUIStore.getState().cloudAuthOpen).toBe(true);

  fireEvent.change(code, { target: { value: "123456" } });
  await submit();

  await waitFor(() => expect(useUIStore.getState().cloudAuthOpen).toBe(false));
  expect(complete).toHaveBeenCalledWith({ code: "123456" });
  expect(h.syncOnLoginReplace).toHaveBeenCalled();
  expect(h.startSessionSync).toHaveBeenCalled();
});

test("a refused code keeps the step open with the reason, and a recovery code can be used instead", async () => {
  const complete = vi.fn<Complete>()
    .mockRejectedValueOnce(new Error("common.error.twoFactorInvalid"))
    .mockResolvedValueOnce(undefined);
  h.signInToCloud.mockRejectedValue(asksForCode(complete));
  useUIStore.getState().openCloudAuth("signin", "link");
  render(<CloudAuthModal />);

  type("layout.auth.emailPlaceholder", "a@x.io");
  type("layout.auth.masterPasswordPlaceholder", "pw");
  await submit();
  fireEvent.change(await screen.findByPlaceholderText("layout.twoFactor.codePlaceholder"), { target: { value: "000000" } });
  await submit();

  expect(await screen.findByText("common.error.twoFactorInvalid")).toBeTruthy();
  expect(useUIStore.getState().cloudAuthOpen).toBe(true);

  await userEvent.click(screen.getByRole("button", { name: "layout.twoFactor.useRecovery" }));
  type("layout.twoFactor.recoveryPlaceholder", "abcd-efgh-jkmn-pqrs");
  await submit();

  await waitFor(() => expect(useUIStore.getState().cloudAuthOpen).toBe(false));
  expect(complete).toHaveBeenLastCalledWith({ recoveryCode: "abcd-efgh-jkmn-pqrs" });
});

test("a server that lost its seed key is only offered a recovery code", async () => {
  h.signInToCloud.mockRejectedValue(asksForCode(async () => {}, ["recovery"]));
  useUIStore.getState().openCloudAuth("signin", "link");
  render(<CloudAuthModal />);

  type("layout.auth.emailPlaceholder", "a@x.io");
  type("layout.auth.masterPasswordPlaceholder", "pw");
  await submit();

  expect(await screen.findByPlaceholderText("layout.twoFactor.recoveryPlaceholder")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "layout.twoFactor.useCode" })).toBeNull();
});

test("signing in again after a revoked session asks only for the password of the current account", async () => {
  h.login.mockResolvedValue(undefined);
  useUIStore.getState().openCloudAuth("signin", "reauth");
  render(<CloudAuthModal />);

  const email = await screen.findByDisplayValue("me@x.io");
  expect((email as HTMLInputElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "layout.auth.createAccount" })).toBeNull();
  expect(screen.getByText("layout.cloudAuthModal.reauthTitle")).toBeTruthy();

  type("layout.auth.masterPasswordPlaceholder", "pw");
  await submit();

  await waitFor(() => expect(useUIStore.getState().cloudAuthOpen).toBe(false));
  expect(h.login).toHaveBeenCalledWith("pw");
  expect(h.signInToCloud).not.toHaveBeenCalled();
  expect(h.syncNow).toHaveBeenCalled();
});

test("a passkey finishes the sign-in through the browser, and the code field is not offered without an authenticator", async () => {
  const complete = vi.fn<Complete>(async () => {});
  h.signInToCloud.mockRejectedValue(asksForCode(complete, ["passkey", "recovery"]));
  let handBack: (code: string) => void = () => {};
  h.passkeyRoundTrip.mockImplementation(() => new Promise<string>((resolve) => (handBack = resolve)));
  useUIStore.getState().openCloudAuth("signin", "link");
  render(<CloudAuthModal />);
  type("layout.auth.emailPlaceholder", "me@x.io");
  type("layout.auth.masterPasswordPlaceholder", "pw");
  await submit();

  expect(await screen.findByText("layout.twoFactor.passkeyOrRecoveryPrompt")).toBeTruthy();
  expect(screen.queryByPlaceholderText("layout.twoFactor.codePlaceholder")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "layout.twoFactor.usePasskey" }));

  expect(h.passkeyRoundTrip).toHaveBeenCalledWith(h.openPasskey);
  expect(await screen.findByText("layout.twoFactor.passkeyWaiting")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "common.action.cancel" }));
  expect(h.cancelPasskeyRoundTrip).toHaveBeenCalled();

  handBack("PASSKEY-CODE");
  await waitFor(() => expect(complete).toHaveBeenCalledWith({ passkeyCode: "PASSKEY-CODE" }));
});

test("giving up on the passkey returns to the form without an error", async () => {
  const { PasskeyCancelledError } = await import("@/services/passkeyRoundTrip");
  const complete = vi.fn<Complete>(async () => {});
  h.signInToCloud.mockRejectedValue(asksForCode(complete, ["totp", "passkey", "recovery"]));
  h.passkeyRoundTrip.mockRejectedValue(new PasskeyCancelledError());
  useUIStore.getState().openCloudAuth("signin", "link");
  render(<CloudAuthModal />);
  type("layout.auth.emailPlaceholder", "me@x.io");
  type("layout.auth.masterPasswordPlaceholder", "pw");
  await submit();

  await userEvent.click(await screen.findByRole("button", { name: "layout.twoFactor.usePasskey" }));

  expect(await screen.findByPlaceholderText("layout.twoFactor.codePlaceholder")).toBeTruthy();
  expect(screen.getByText("layout.twoFactor.passkeyOrCodePrompt")).toBeTruthy();
  expect(document.querySelector('[class*="t-status-error"]')).toBeNull();
  expect(complete).not.toHaveBeenCalled();
});
