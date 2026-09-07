import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, string>) => (o?.owner ? `${k} ${o.owner}` : k),
  }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/teamVaultSync", () => ({ fetchTeamData: vi.fn(async () => {}) }));

// The shell's own chrome and every tab screen are irrelevant here: this asserts
// which of them the blocked-vault panel replaces, not what they render.
vi.mock("./MobileSessionLayer", () => ({ default: () => null }));
vi.mock("./screens/MobileHostsScreen", () => ({ default: () => <div>hosts-screen</div> }));
vi.mock("./screens/MobileSnippetsScreen", () => ({ default: () => <div>snippets-screen</div> }));
vi.mock("./screens/MobileTerminalScreen", () => ({ default: () => <div>terminal-screen</div> }));
vi.mock("./panels/MobileSftpScreen", () => ({ default: () => <div>sftp-screen</div> }));

import MobileShell from "./MobileShell";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { Team } from "@/services/teamService";

const TEAM: Team = {
  id: "t1", name: "Ops", owner_id: "u9", owner_tier: "team", created_at: "", role_ids: [],
};

beforeEach(() => {
  useTeamStore.setState({
    teams: [TEAM],
    membersByTeam: { t1: [] },
    rolesByTeam: { t1: [] },
  });
  useVaultStore.setState({ vaults: [], selectedVaultIds: ["t1"] });
  useTeamVaultStateStore.setState({ statusByTeamId: {} });
  useMobileNavStore.setState({ tab: "hosts", stack: [], sheet: null });
  useSessionStore.setState({ sessions: [] });
});
afterEach(cleanup);

test("a keyless team vault explains itself instead of showing an empty hosts list", () => {
  useTeamVaultStateStore.setState({ statusByTeamId: { t1: "awaiting_key" } });

  render(<MobileShell />);

  expect(screen.getByText("layout.mainPanel.teamVault.waitingForAccessTitle")).toBeTruthy();
  expect(screen.queryByText("hosts-screen")).toBeNull();
});

test("the blocked vault is escapable — the vault switcher stays reachable", () => {
  useTeamVaultStateStore.setState({ statusByTeamId: { t1: "awaiting_key" } });

  const { container } = render(<MobileShell />);

  // MobileHeader is the only route to the vault switcher on mobile, and it
  // lives inside the tab screens the panel replaces. Without it a member who
  // opens a keyless vault cannot get back to any other one.
  expect(container.querySelector("[data-mobile-vault-switch]")).not.toBeNull();
});

test("the blocked panel never hides the tab bar", () => {
  useSessionStore.setState({ sessions: [{ id: "s1" }] as never });
  useMobileNavStore.setState({ tab: "terminal" });
  useTeamVaultStateStore.setState({ statusByTeamId: { t1: "awaiting_key" } });

  const { container } = render(<MobileShell />);

  // Immersive mode hides the tab bar for a live terminal; with the panel on top
  // of it that would leave no navigation at all.
  expect(container.querySelector("[data-mobile-tab]")).not.toBeNull();
});

test("a loaded team vault shows its pages", () => {
  useTeamVaultStateStore.setState({ statusByTeamId: { t1: "loaded" } });

  render(<MobileShell />);

  expect(screen.getByText("hosts-screen")).toBeTruthy();
  expect(screen.queryByText("layout.mainPanel.teamVault.waitingForAccessTitle")).toBeNull();
});
