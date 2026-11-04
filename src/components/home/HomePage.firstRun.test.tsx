import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ hosts: 0, teams: 0 }));

vi.mock("@/hooks/useAllConnections", () => ({
  useAllConnections: () => Array.from({ length: state.hosts }, (_, i) => ({ id: `c${i}` })),
}));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: (sel: (s: { teams: unknown[] }) => unknown) => sel({ teams: Array.from({ length: state.teams }) }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("./DashboardHero", () => ({ DashboardHero: ({ firstRun }: { firstRun: boolean }) => <div>hero:{String(firstRun)}</div> }));
vi.mock("./FirstRunPanel", () => ({ FirstRunPanel: () => <div>first-run</div> }));
vi.mock("./RecentHostsSection", () => ({ RecentHostsSection: () => null }));
vi.mock("./VaultsOverview", () => ({ VaultsOverview: () => <div>vaults</div> }));
vi.mock("./AllHostsView", () => ({ AllHostsView: () => null }));
vi.mock("@/components/hosts/TeamSessions", () => ({ TeamSessions: () => <div>team-sessions</div> }));

import HomePage from "./HomePage";

beforeEach(() => {
  cleanup();
  state.hosts = 0;
  state.teams = 0;
});

test("a solo user with no hosts sees only the first-run panel", () => {
  render(<HomePage />);
  expect(screen.getByText("first-run")).toBeTruthy();
  expect(screen.getByText("hero:true")).toBeTruthy();
  expect(screen.queryByText("team-sessions")).toBeNull();
  expect(screen.queryByText("vaults")).toBeNull();
  expect(screen.queryByText("home.quickActions.export")).toBeNull();
});

test("a team member with no hosts keeps team sessions and vaults", () => {
  state.teams = 1;
  render(<HomePage />);
  expect(screen.getByText("first-run")).toBeTruthy();
  expect(screen.getByText("team-sessions")).toBeTruthy();
  expect(screen.getByText("vaults")).toBeTruthy();
});

test("anyone with hosts gets the regular dashboard", () => {
  state.hosts = 2;
  render(<HomePage />);
  expect(screen.queryByText("first-run")).toBeNull();
  expect(screen.getByText("hero:false")).toBeTruthy();
  expect(screen.getByText("home.quickActions.export")).toBeTruthy();
  expect(screen.getByText("team-sessions")).toBeTruthy();
  expect(screen.getByText("vaults")).toBeTruthy();
});
