// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/appLock", () => ({ systemAuthAvailable: async () => false }));
vi.mock("@/utils/platform", async () => ({
  ...(await vi.importActual<typeof import("@/utils/platform")>("@/utils/platform")),
  usePlatform: () => "linux",
  useIsAndroid: () => false, useIsMobile: () => false,
}));

import { SessionSecuritySettings } from "./SessionSecuritySettings";
import { useSecurityStore } from "@/stores/securityStore";
import { resetPolicy, withPolicy, withTeamPolicy } from "@/test/policy";

const LIMITS = { "security.lockTimeoutMinutes": { $range: { max: 15 } }, "security.lockAction": "vault" };

beforeEach(() => {
  useSecurityStore.setState({ sessionTimeoutMinutes: null, lockAction: "screen", systemAuthUnlock: false });
  resetPolicy();
  withTeamPolicy(LIMITS);
});
afterEach(cleanup);

test("the policy clamps the shown values, hides looser choices and names the team", () => {
  render(<SessionSecuritySettings mode="server" />);
  const autoLock = screen.getByRole("button", { name: "settings.account.sessionSecurity.autoLockLabel" });
  expect(autoLock.textContent).toContain("settings.account.sessionSecurity.timeout.15min");
  fireEvent.click(autoLock);
  expect(screen.queryByText("settings.account.sessionSecurity.timeout.never")).toBeNull();
  expect(screen.queryByText("settings.account.sessionSecurity.timeout.30min")).toBeNull();
  expect(screen.getByText("settings.account.sessionSecurity.timeout.5min")).toBeTruthy();
  expect(screen.getByText(/settings\.account\.sessionSecurity\.policy\.timeout .*Acme/)).toBeTruthy();
  expect(screen.getByText(/settings\.account\.sessionSecurity\.policy\.vault .*Acme/)).toBeTruthy();
  const action = screen.getByRole("button", { name: "settings.account.sessionSecurity.lockAction.label" });
  expect(action.textContent).toContain("settings.account.sessionSecurity.lockAction.vault");
});

test("a machine-only limit shows the managed note instead of a team", () => {
  resetPolicy();
  withPolicy(LIMITS);
  render(<SessionSecuritySettings mode="server" />);
  expect(screen.queryByText(/sessionSecurity\.policy\./)).toBeNull();
  expect(screen.getAllByText("common.policy.managed")).toHaveLength(2);
});

test("without a policy nothing changes", () => {
  resetPolicy();
  render(<SessionSecuritySettings mode="server" />);
  expect(screen.queryByText(/sessionSecurity\.policy\./)).toBeNull();
  expect(screen.getByRole("button", { name: "settings.account.sessionSecurity.autoLockLabel" }).textContent)
    .toContain("settings.account.sessionSecurity.timeout.never");
});

const timeoutButton = () => screen.getByRole("button", { name: "settings.account.sessionSecurity.autoLockLabel" });
const actionButton = () => screen.getByRole("button", { name: "settings.account.sessionSecurity.lockAction.label" });
const frozen = (el: HTMLElement) => (el.closest("fieldset") as HTMLFieldSetElement | null)?.disabled === true;

test.each([[30], [null]])("a timeout locked exactly to %s disables the control without an at-most note", (value) => {
  resetPolicy();
  withPolicy({ "security.lockTimeoutMinutes": value });
  render(<SessionSecuritySettings mode="server" />);
  expect(frozen(timeoutButton())).toBe(true);
  expect(screen.getByText("common.policy.managed")).toBeTruthy();
  expect(screen.queryByText(/sessionSecurity\.policy\.timeout/)).toBeNull();
});

test("a lock action locked to screen disables the control and shows the note", () => {
  resetPolicy();
  withPolicy({ "security.lockAction": "screen" });
  render(<SessionSecuritySettings mode="server" />);
  expect(frozen(actionButton())).toBe(true);
  expect(actionButton().textContent).toContain("settings.account.sessionSecurity.lockAction.screen");
  expect(screen.getByText("common.policy.managed")).toBeTruthy();
});

test("a timeout range with only allowed values filters the options and shows the note", () => {
  resetPolicy();
  withPolicy({ "security.lockTimeoutMinutes": { $range: { allowed: [5, 60] } } });
  render(<SessionSecuritySettings mode="server" />);
  expect(frozen(timeoutButton())).toBe(false);
  fireEvent.click(timeoutButton());
  expect(screen.getAllByText("settings.account.sessionSecurity.timeout.1h").length).toBeGreaterThan(0);
  expect(screen.queryByText("settings.account.sessionSecurity.timeout.never")).toBeNull();
  expect(screen.queryByText("settings.account.sessionSecurity.timeout.30min")).toBeNull();
  expect(screen.getByText(/common\.policy\.rangeAllowed/)).toBeTruthy();
});
