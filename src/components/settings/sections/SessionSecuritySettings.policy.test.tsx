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
  useIsAndroid: () => false,
}));

import { SessionSecuritySettings } from "./SessionSecuritySettings";
import { useSecurityStore } from "@/stores/securityStore";
import { useOrgLockPolicyStore } from "@/stores/orgLockPolicyStore";
import { useTeamStore } from "@/stores/teamStore";

beforeEach(() => {
  useSecurityStore.setState({ sessionTimeoutMinutes: null, lockAction: "screen", systemAuthUnlock: false });
  useOrgLockPolicyStore.setState({ policy: { maxMinutes: 15, forceVault: true } });
  useTeamStore.setState({
    teams: [{ id: "t", name: "Acme", owner_id: "o", owner_tier: "business", created_at: "", role_ids: [], lock_policy: { max_minutes: 15, force_vault: true } }],
  });
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

test("offline, with only the cached policy, the line falls back to your team", () => {
  useTeamStore.setState({ teams: [] });
  render(<SessionSecuritySettings mode="server" />);
  expect(screen.getByText(/policy\.timeout .*settings\.account\.sessionSecurity\.policy\.yourTeam/)).toBeTruthy();
});

test("without a policy nothing changes", () => {
  useOrgLockPolicyStore.setState({ policy: null });
  render(<SessionSecuritySettings mode="server" />);
  expect(screen.queryByText(/sessionSecurity\.policy\./)).toBeNull();
  expect(screen.getByRole("button", { name: "settings.account.sessionSecurity.autoLockLabel" }).textContent)
    .toContain("settings.account.sessionSecurity.timeout.never");
});
