import { test, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ hosts: 0, teams: 0, liveSessions: 0 }));

vi.mock("@/hooks/useAllConnections", () => ({
  useAllConnections: () => Array.from({ length: state.hosts }, (_, i) => ({ id: `c${i}` })),
}));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: (sel: (s: { teams: unknown[] }) => unknown) => sel({ teams: Array.from({ length: state.teams }) }),
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/stores/teamSessionStore", () => ({
  useTeamSessionStore: (sel: (s: { activeSessions: unknown[] }) => unknown) => sel({ activeSessions: Array.from({ length: state.liveSessions }) }),
}));
vi.mock("./FirstRunPanel", () => ({
  FirstRunPanel: () => <div>first-run</div>,
  TextLink: ({ label }: { label: string }) => <button>{label}</button>,
}));
vi.mock("./ConnectPrompt", () => ({ ConnectPrompt: () => <div>connect-prompt</div>, useNewHost: () => () => {} }));
vi.mock("./RecentHostsSection", () => ({ RecentHostsSection: () => null }));
vi.mock("./VaultsOverview", () => ({ VaultsOverview: () => <div>vaults</div> }));
vi.mock("./AllHostsView", () => ({ AllHostsView: () => null }));
vi.mock("@/components/hosts/TeamSessions", () => ({ TeamSessions: () => <div>team-sessions</div> }));

import HomePage from "./HomePage";

beforeEach(() => {
  cleanup();
  state.hosts = 0;
  state.teams = 0;
  state.liveSessions = 0;
});

test("a solo user with no hosts sees only the first-run panel", () => {
  render(<HomePage />);
  expect(screen.getByText("first-run")).toBeTruthy();
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

test("anyone with hosts gets the connect prompt and dashboard", () => {
  state.hosts = 2;
  render(<HomePage />);
  expect(screen.queryByText("first-run")).toBeNull();
  expect(screen.getByText("connect-prompt")).toBeTruthy();
  expect(screen.getByText("home.quickActions.export")).toBeTruthy();
  expect(screen.getByText("vaults")).toBeTruthy();
});

test("a solo user with hosts does not see team sessions until one is live", () => {
  state.hosts = 2;
  render(<HomePage />);
  expect(screen.queryByText("team-sessions")).toBeNull();
  cleanup();
  state.liveSessions = 1;
  render(<HomePage />);
  expect(screen.getByText("team-sessions")).toBeTruthy();
});

test("a team member with hosts sees team sessions", () => {
  state.hosts = 2;
  state.teams = 1;
  render(<HomePage />);
  expect(screen.getByText("team-sessions")).toBeTruthy();
});
