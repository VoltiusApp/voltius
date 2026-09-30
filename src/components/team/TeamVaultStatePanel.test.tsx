import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, string>) => (o?.owner ? `${k} ${o.owner}` : k),
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/teamVaultSync", () => ({ fetchTeamData: vi.fn(async () => {}) }));
vi.mock("@/services/updater", () => ({ checkForUpdate: vi.fn(async () => {}) }));

import TeamVaultStatePanel from "./TeamVaultStatePanel";
import { checkForUpdate } from "@/services/updater";
import { useTeamStore } from "@/stores/teamStore";
import type { Team, TeamMember } from "@/services/teamService";
import { PERM_BITS } from "@/services/permissions";

const TEAM: Team = {
  id: "t1", name: "Ops", owner_id: "u9", owner_tier: "team", created_at: "", role_ids: [],
};
function member(user_id: string, handle?: string): TeamMember {
  return {
    team_id: "t1", user_id, handle, public_key: "pk",
    invited_by_display_name: null, joined_at: "", role_ids: [],
  };
}

beforeEach(() => {
  useTeamStore.setState({ teams: [TEAM], membersByTeam: {}, rolesByTeam: { t1: [] } });
});
afterEach(cleanup);

test("the waiting copy names the owner the member is waiting on", () => {
  useTeamStore.setState({ membersByTeam: { t1: [member("u9", "bob")] } });

  render(<TeamVaultStatePanel status="awaiting_key" teamId="t1" />);

  expect(screen.getByText("layout.mainPanel.teamVault.waitingForAccessBodyNamed @bob")).toBeTruthy();
});

test("the waiting copy stays generic while the owner's handle is unknown", () => {
  useTeamStore.setState({ membersByTeam: { t1: [member("u9")] } });

  render(<TeamVaultStatePanel status="awaiting_key" teamId="t1" />);

  expect(screen.getByText("layout.mainPanel.teamVault.waitingForAccessBody")).toBeTruthy();
});

test("a key mismatch names the sign-in that heals it instead of offering a retry", () => {
  render(<TeamVaultStatePanel status="key_mismatch" teamId="t1" />);

  expect(screen.getByText("layout.mainPanel.teamVault.keyMismatchBody")).toBeTruthy();
  expect(screen.queryByText("layout.mainPanel.tryAgain")).toBeNull();
});

test("an unrecognised status falls back to the generic error", () => {
  render(<TeamVaultStatePanel status="banana" teamId="t1" />);

  expect(screen.getByText("layout.mainPanel.teamVault.errorTitle")).toBeTruthy();
});

test("update_required explains itself and offers a check for updates", () => {
  render(<TeamVaultStatePanel status="update_required" teamId="t1" />);

  expect(screen.getByText("layout.mainPanel.teamVault.updateRequiredTitle")).toBeTruthy();
  fireEvent.click(screen.getByText("layout.mainPanel.checkForUpdates"));
  expect(checkForUpdate).toHaveBeenCalled();
});

test("plan_lapsed tells the member the Business plan lapsed", () => {
  render(<TeamVaultStatePanel status="plan_lapsed" teamId="t1" />);
  expect(screen.getByText("layout.mainPanel.teamVault.planLapsedTitle")).toBeTruthy();
  expect(screen.getByText("layout.mainPanel.teamVault.planLapsedBody")).toBeTruthy();
});

test("forbidden keeps the generic copy even for a lapsed member", () => {
  useTeamStore.setState({
    teams: [{ ...TEAM, owner_tier: "teams", permission_allow: PERM_BITS.VIEW | PERM_BITS.CONNECT }],
    rolesByTeam: { t1: [] },
  });
  render(<TeamVaultStatePanel status="forbidden" teamId="t1" />);
  expect(screen.getByText("layout.mainPanel.teamVault.forbiddenTitle")).toBeTruthy();
  expect(screen.queryByText("layout.mainPanel.teamVault.planLapsedTitle")).toBeNull();
});
