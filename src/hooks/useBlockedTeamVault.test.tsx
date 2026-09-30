import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

import { useTeamCredentialsUnavailable } from "./useBlockedTeamVault";
import { TeamCredentialsNote } from "@/components/shared/VaultUnavailableNote";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";
import { PERM_BITS } from "@/services/permissions";

const initialVault = useVaultStore.getState();
const initialTeam = useTeamStore.getState();

afterEach(() => {
  cleanup();
  useVaultStore.setState(initialVault, true);
  useTeamStore.setState(initialTeam, true);
  useTeamVaultStateStore.getState().clearAll();
});

function Warning() {
  const reason = useTeamCredentialsUnavailable();
  return reason ? <TeamCredentialsNote reason={reason} /> : null;
}

function selectTeam(masks: { owner_tier: string; permission_allow?: number; permission_deny?: number }) {
  useTeamStore.setState({ teams: [{ id: "t1", name: "Ops", role_ids: [], ...masks }] as never, rolesByTeam: { t1: [] } });
  useVaultStore.setState({ vaults: [], selectedVaultIds: ["t1"] });
  useTeamVaultStateStore.getState().setCredentialsUnavailable("t1", true);
}

test("a member who lost Connect to the lapse is told the plan lapsed", () => {
  selectTeam({ owner_tier: "teams", permission_allow: PERM_BITS.VIEW | PERM_BITS.CONNECT });
  render(<Warning />);
  expect(screen.getByText("layout.mainPanel.teamVault.planLapsedBody")).toBeTruthy();
  expect(screen.queryByText("shared.teamCredentials.unavailable")).toBeNull();
});

test("the same grant on a Business team keeps the generic warning", () => {
  selectTeam({ owner_tier: "business", permission_allow: PERM_BITS.VIEW | PERM_BITS.CONNECT });
  render(<Warning />);
  expect(screen.getByText("shared.teamCredentials.unavailable")).toBeTruthy();
});

test("no warning while the credentials loaded, lapsed or not", () => {
  selectTeam({ owner_tier: "teams", permission_allow: PERM_BITS.VIEW | PERM_BITS.CONNECT });
  useTeamVaultStateStore.getState().setCredentialsUnavailable("t1", false);
  const { container } = render(<Warning />);
  expect(container.innerHTML).toBe("");
});
