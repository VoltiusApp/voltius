// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  status: "os-login" as string,
  stop: vi.fn(async () => {}),
  start: vi.fn(async (_pw: string) => true as boolean | null),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/appLock", () => ({ systemAuthAvailable: async () => true }));
vi.mock("@/services/vaultBinding", () => ({
  bindingStatus: vi.fn(async () => h.status),
  enableBinding: vi.fn(), disableBinding: vi.fn(async () => "ok"), disableWithPassword: vi.fn(), bindNow: vi.fn(),
}));
vi.mock("@/services/masterPasswordMemory", async () => {
  const { useSecurityStore } = await import("@/stores/securityStore");
  return {
    stopRememberingMasterPassword: vi.fn(async () => {
      useSecurityStore.getState().setRememberMasterPassword(false);
      await h.stop();
    }),
    startRememberingMasterPassword: vi.fn(async (pw: string) => {
      const ok = await h.start(pw);
      if (ok) useSecurityStore.getState().setRememberMasterPassword(true);
      return ok;
    }),
  };
});
vi.mock("@/utils/platform", async () => ({
  ...(await vi.importActual<typeof import("@/utils/platform")>("@/utils/platform")),
  usePlatform: () => "linux",
  useIsAndroid: () => false, useIsMobile: () => false,
}));

import { SessionSecuritySettings } from "./SessionSecuritySettings";
import { useSecurityStore } from "@/stores/securityStore";
import { useOrgLockPolicyStore } from "@/stores/orgLockPolicyStore";

const K = "settings.account.sessionSecurity.rememberPassword";
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const remember = () => screen.getByRole("switch", { name: `${K}.toggle` });

beforeEach(() => {
  vi.clearAllMocks();
  h.status = "os-login";
  useSecurityStore.setState({ sessionTimeoutMinutes: null, lockAction: "vault", systemAuthUnlock: true, rememberMasterPassword: true });
  useOrgLockPolicyStore.setState({ policy: null });
});
afterEach(cleanup);

test("is offered for password accounts, with the honest description", async () => {
  render(<SessionSecuritySettings mode="local" />);
  await flush();
  expect(remember().getAttribute("aria-checked")).toBe("true");
  expect(screen.getByText(`${K}.desc`)).toBeTruthy();
});

test("is not offered for an OS-keychain account, which has no master password", async () => {
  h.status = "no-password";
  render(<SessionSecuritySettings mode="local-nopassword" />);
  await flush();
  expect(screen.queryByRole("switch", { name: `${K}.toggle` })).toBeNull();
});

test("turning it off removes the stored copy and says system authentication now needs it", async () => {
  render(<SessionSecuritySettings mode="server" />);
  await flush();
  expect(screen.queryByText(`${K}.systemAuthNeedsIt`)).toBeNull();
  fireEvent.click(remember());
  await flush();
  expect(h.stop).toHaveBeenCalledTimes(1);
  expect(useSecurityStore.getState().rememberMasterPassword).toBe(false);
  expect(screen.getByText(`${K}.systemAuthNeedsIt`)).toBeTruthy();
});

test("a hardware-bound copy keeps system authentication working, so no warning", async () => {
  h.status = "bound";
  useSecurityStore.setState({ rememberMasterPassword: false });
  render(<SessionSecuritySettings mode="local" />);
  await flush();
  expect(screen.queryByText(`${K}.systemAuthNeedsIt`)).toBeNull();
});

test("turning it back on asks for the current password", async () => {
  useSecurityStore.setState({ rememberMasterPassword: false });
  h.start.mockResolvedValueOnce(false);
  render(<SessionSecuritySettings mode="local" />);
  await flush();
  fireEvent.click(remember());
  const input = screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder");
  fireEvent.change(input, { target: { value: "nope" } });
  fireEvent.click(screen.getByText("settings.account.sessionSecurity.systemAuth.confirm"));
  await flush();
  expect(screen.getByText("layout.appLock.wrongPassword")).toBeTruthy();
  expect(useSecurityStore.getState().rememberMasterPassword).toBe(false);

  fireEvent.change(input, { target: { value: "pw" } });
  fireEvent.click(screen.getByText("settings.account.sessionSecurity.systemAuth.confirm"));
  await flush();
  expect(h.start).toHaveBeenLastCalledWith("pw");
  expect(useSecurityStore.getState().rememberMasterPassword).toBe(true);
});

test("Bind now asks for the password when there is no remembered copy to seal", async () => {
  h.status = "unbound";
  useSecurityStore.setState({ rememberMasterPassword: false });
  render(<SessionSecuritySettings mode="local" />);
  await flush();
  fireEvent.click(screen.getByText("settings.account.sessionSecurity.systemAuth.bindNow"));
  expect(screen.getByText("settings.account.sessionSecurity.systemAuth.enableTitle")).toBeTruthy();
});
