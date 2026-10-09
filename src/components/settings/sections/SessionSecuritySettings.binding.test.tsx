// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  status: "unbound" as string,
  enable: vi.fn(async (_pw: string, _r: string) => "ok" as string),
  disable: vi.fn(async (_r: string) => "ok" as string),
  disableWithPassword: vi.fn(async (_pw: string) => true),
  bindNow: vi.fn(async (_r: string) => "ok" as string),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/appLock", () => ({ systemAuthAvailable: async () => true }));
vi.mock("@/services/vaultBinding", () => ({
  bindingStatus: vi.fn(async () => h.status),
  enableBinding: h.enable,
  disableBinding: h.disable,
  disableWithPassword: h.disableWithPassword,
  bindNow: h.bindNow,
}));
vi.mock("@/utils/platform", async () => ({
  ...(await vi.importActual<typeof import("@/utils/platform")>("@/utils/platform")),
  usePlatform: () => "windows",
  useIsAndroid: () => false,
}));

import { SessionSecuritySettings } from "./SessionSecuritySettings";
import { useSecurityStore } from "@/stores/securityStore";
import { useOrgLockPolicyStore } from "@/stores/orgLockPolicyStore";

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const toggle = () => screen.getByRole("switch", { name: "settings.account.sessionSecurity.systemAuth.toggle" });
const typePassword = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText("layout.auth.masterPasswordPlaceholder"), { target: { value } });
const confirm = () => fireEvent.click(screen.getByText("settings.account.sessionSecurity.systemAuth.confirm"));

beforeEach(() => {
  vi.clearAllMocks();
  h.status = "unbound";
  useSecurityStore.setState({ sessionTimeoutMinutes: null, lockAction: "vault", systemAuthUnlock: false });
  useOrgLockPolicyStore.setState({ policy: null });
});
afterEach(cleanup);

test("turning it on for a bindable account asks for the password, then binds", async () => {
  render(<SessionSecuritySettings mode="local" />);
  await flush();
  fireEvent.click(toggle());
  expect(useSecurityStore.getState().systemAuthUnlock).toBe(false);
  typePassword("pw");
  confirm();
  await flush();
  expect(h.enable).toHaveBeenCalledWith("pw", "layout.appLock.sealReason");
  expect(useSecurityStore.getState().systemAuthUnlock).toBe(true);
});

test("a wrong password leaves it off", async () => {
  h.enable.mockResolvedValueOnce("wrong-password");
  render(<SessionSecuritySettings mode="local" />);
  await flush();
  fireEvent.click(toggle());
  typePassword("nope");
  confirm();
  await flush();
  expect(screen.getByText("layout.appLock.wrongPassword")).toBeTruthy();
  expect(useSecurityStore.getState().systemAuthUnlock).toBe(false);
});

test("a device that cannot bind turns on without a password", async () => {
  h.status = "os-login";
  render(<SessionSecuritySettings mode="local" />);
  await flush();
  fireEvent.click(toggle());
  expect(useSecurityStore.getState().systemAuthUnlock).toBe(true);
  expect(h.enable).not.toHaveBeenCalled();
});

test("turning it off unbinds with the prompt", async () => {
  h.status = "bound";
  useSecurityStore.setState({ systemAuthUnlock: true });
  render(<SessionSecuritySettings mode="local" />);
  await flush();
  expect(screen.getByText("settings.account.sessionSecurity.systemAuth.status.bound")).toBeTruthy();
  fireEvent.click(toggle());
  await flush();
  expect(h.disable).toHaveBeenCalled();
  expect(useSecurityStore.getState().systemAuthUnlock).toBe(false);
});

test("a cancelled unbind falls back to the password", async () => {
  h.status = "bound";
  h.disable.mockResolvedValueOnce("cancelled");
  useSecurityStore.setState({ systemAuthUnlock: true });
  render(<SessionSecuritySettings mode="local" />);
  await flush();
  fireEvent.click(toggle());
  await flush();
  expect(useSecurityStore.getState().systemAuthUnlock).toBe(true);
  typePassword("pw");
  confirm();
  await flush();
  expect(h.disableWithPassword).toHaveBeenCalledWith("pw");
  expect(useSecurityStore.getState().systemAuthUnlock).toBe(false);
});

test("an unbound device offers Bind now", async () => {
  useSecurityStore.setState({ systemAuthUnlock: true });
  render(<SessionSecuritySettings mode="local" />);
  await flush();
  fireEvent.click(screen.getByText("settings.account.sessionSecurity.systemAuth.bindNow"));
  await flush();
  expect(h.bindNow).toHaveBeenCalledWith("layout.appLock.sealReason");
});
