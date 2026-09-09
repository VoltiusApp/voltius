import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

// Ported from VaultsSection.MakePrivate.test.tsx (#229) when VaultGeneralTab was
// replaced by VaultSettingsBody. The three cases below are dev's, unchanged in
// substance — only the component under test and its prop shape differ.
const teamVaultState = vi.hoisted(() => ({ unencryptedCountByTeamId: {} as Record<string, number> }));
const h = vi.hoisted(() => ({ t: vi.fn((k: string) => k) }));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: h.t }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/hooks/useVaultContents", () => ({ useVaultContents: () => [] }));
vi.mock("./useVaultAdminActions", () => ({
  useVaultAdminActions: () => ({ busy: false, rename: vi.fn(), remove: vi.fn(), makePrivate: vi.fn() }),
}));
vi.mock("@/stores/teamStore", () => {
  const state = { teams: [], rolesByTeam: {}, membersByTeam: { t1: [] } };
  return {
    useTeamStore: Object.assign(
      (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
      { getState: () => state },
    ),
  };
});
vi.mock("@/stores/teamVaultStateStore", () => ({
  useTeamVaultStateStore: (sel: (s: unknown) => unknown) =>
    sel({ unencryptedCountByTeamId: teamVaultState.unencryptedCountByTeamId }),
}));

import { VaultSettingsBody } from "./VaultSettingsBody";
import type { VaultAdminTarget } from "./vaultAdminTarget";

const target: VaultAdminTarget = { kind: "local", vaultId: "v1", teamId: "t1", name: "My Vault" };

function renderBody() {
  render(
    <VaultSettingsBody
      target={target}
      onRenamed={vi.fn()}
      onDone={vi.fn()}
      onRequestDialog={vi.fn()}
    />,
  );
}

beforeEach(() => {
  teamVaultState.unencryptedCountByTeamId = {};
  h.t.mockImplementation((k: string) => k);
});
afterEach(cleanup);

test("warns when the team still holds unencrypted objects", () => {
  h.t.mockImplementation((k: string, o?: { count?: number }) =>
    o?.count !== undefined ? `${k} ${o.count}` : k);
  teamVaultState.unencryptedCountByTeamId = { t1: 3 };

  renderBody();

  expect(screen.getByText("settings.vaults.general.unencryptedObjects 3")).toBeTruthy();
});

test("says nothing when the count is zero", () => {
  teamVaultState.unencryptedCountByTeamId = { t1: 0 };

  renderBody();

  expect(screen.queryByText(/unencryptedObjects/)).toBeNull();
});

test("says nothing when the team has no entry at all", () => {
  // The re-encryption pass never ran for a team with no objects, so the map
  // has no key for it — that must render as "nothing to report", not a warning.
  teamVaultState.unencryptedCountByTeamId = {};

  renderBody();

  expect(screen.queryByText(/unencryptedObjects/)).toBeNull();
});
