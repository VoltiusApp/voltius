import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import type { Team, TeamMember, TeamRole } from "@/services/teamService";

const api = vi.hoisted(() => ({
  listTeams: vi.fn(async () => [] as Team[]),
  listRoles: vi.fn(async () => [] as TeamRole[]),
  listMembers: vi.fn(async () => [] as TeamMember[]),
  getMyUserId: vi.fn(async () => ""),
}));
vi.mock("@/services/teamService", () => api);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/theme-creator/ColorPicker", () => ({ ColorPicker: () => null }));

import RolesSection from "@/components/settings/sections/RolesSection";
import { useTeamStore } from "@/stores/teamStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

const team = (id: string, name: string): Team =>
  ({ id, name, owner_id: "", owner_tier: "business", created_at: "", role_ids: [] });

beforeEach(() => {
  localStorage.clear();
  Object.values(api).forEach((f) => (f as ReturnType<typeof vi.fn>).mockReset?.());
  api.getMyUserId.mockResolvedValue("me");
  api.listRoles.mockResolvedValue([]);
  api.listMembers.mockResolvedValue([]);
  useTeamStore.setState({
    teams: [], membersByTeam: {}, rolesByTeam: {},
    pendingInvitationsByTeam: {}, myPendingInvitations: [], activeTeamId: null, loading: false,
  });
  useSubscriptionStore.setState({ isBusiness: true });
});
afterEach(() => cleanup());

test("no teams: renders empty-state prompt, no team panel", async () => {
  api.listTeams.mockResolvedValue([]);
  render(<RolesSection />);
  expect(await screen.findByText("settings.vaults.rolesPanel.noTeams")).toBeTruthy();
  expect(screen.queryByText("settings.vaults.rolesPanel.builtinRoles")).toBeNull();
});

test("single team + resolved user id: panel renders, no team selector", async () => {
  api.listTeams.mockResolvedValue([team("t1", "Alpha")]);
  render(<RolesSection />);
  expect(await screen.findByText("settings.vaults.rolesPanel.builtinRoles")).toBeTruthy();
  expect(screen.queryByText("settings.vaults.rolesPanel.teamLabel")).toBeNull();
});

test("multiple teams: team selector rendered with an option per team", async () => {
  api.listTeams.mockResolvedValue([team("t1", "Alpha"), team("t2", "Beta")]);
  render(<RolesSection />);
  expect(await screen.findByText("settings.vaults.rolesPanel.teamLabel")).toBeTruthy();
  expect(screen.getByRole("option", { name: "Alpha" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Beta" })).toBeTruthy();
});

test("panel gated on resolved user id: no user id → panel not rendered even with a team", async () => {
  api.getMyUserId.mockResolvedValue("");
  api.listTeams.mockResolvedValue([team("t1", "Alpha")]);
  render(<RolesSection />);
  await waitFor(() => expect(useTeamStore.getState().teams.length).toBe(1));
  expect(screen.queryByText("settings.vaults.rolesPanel.builtinRoles")).toBeNull();
});
