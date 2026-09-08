import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  deleteTeam: vi.fn(async (_id: string) => {}),
  addToast: vi.fn(),
  fetchTeamData: vi.fn(async (_id: string) => {}),
  clearTeamKeyCache: vi.fn(),
  reloadLocalVaultObjectStores: vi.fn(async () => {}),
  saveConnection: vi.fn(async (_c: unknown) => {}),
  clearTeamConnections: vi.fn(),
  setStatus: vi.fn(),
  setVaultTeamId: vi.fn(),
  t: vi.fn((k: string) => k),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.t }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@/services/teamService", () => ({
  deleteTeam: h.deleteTeam,
  searchUsers: vi.fn(async () => []),
  getMyUserId: vi.fn(async () => "me"),
  inviteByEmail: vi.fn(),
  listPendingInvitations: vi.fn(async () => []),
  revokePendingInvitation: vi.fn(),
}));
vi.mock("@/hooks/useVaultContents", () => ({ useVaultContents: () => [] }));
vi.mock("@/hooks/useUIContributions", () => ({ useUIContributions: () => [] }));
vi.mock("./RolesSection", () => ({ TeamRolesPanel: () => null, default: () => null }));
vi.mock("@/components/settings/BuySeatsModal", () => ({ default: () => null }));
vi.mock("@/components/shared/ContentCounts", () => ({ ContentCounts: () => null }));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn(async () => {}) }));
vi.mock("@/services/teamVaultActivation", () => ({ markTeamVaultLoadedAfterLocalActivation: vi.fn() }));
vi.mock("@/services/vaultTeamMigration", () => ({
  reloadLocalVaultObjectStores: h.reloadLocalVaultObjectStores,
}));
vi.mock("@/services/teamVaultSync", () => ({
  fetchTeamData: h.fetchTeamData,
  clearTeamKeyCache: h.clearTeamKeyCache,
}));
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: { getState: () => ({ addToast: h.addToast }) },
}));

// One team connection is enough to exercise the copy step; the other entity
// kinds share the same Promise.allSettled and are left empty.
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: {
    getState: () => ({
      teamConnections: {
        t1: [{
          id: "c1", name: "web", host: "h", port: 22, username: "u",
          auth_type: "password", tags: [], identity_id: null, folder_id: null,
        }],
      },
      clearTeamConnections: h.clearTeamConnections,
    }),
  },
}));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: { getState: () => ({ teamIdentities: {}, clearTeamIdentities: vi.fn() }) },
}));
vi.mock("@/stores/keyStore", () => ({
  useKeyStore: { getState: () => ({ teamKeys: {}, clearTeamKeys: vi.fn() }) },
}));
vi.mock("@/stores/folderStore", () => ({
  useFolderStore: { getState: () => ({ teamFolders: {}, clearTeamFolders: vi.fn() }) },
}));
vi.mock("@/stores/snippetStore", () => ({
  useSnippetStore: { getState: () => ({ teamSnippets: {}, clearTeamSnippets: vi.fn() }) },
}));
vi.mock("@/stores/snippetFolderStore", () => ({
  useSnippetFolderStore: { getState: () => ({ teamSnippetFolders: {}, clearTeamSnippetFolders: vi.fn() }) },
}));
vi.mock("@/stores/portForwardingStore", () => ({
  usePortForwardingStore: { getState: () => ({ teamRules: {}, clearTeamRules: vi.fn() }) },
}));
vi.mock("@/stores/teamVaultStateStore", () => ({
  useTeamVaultStateStore: { getState: () => ({ setStatus: h.setStatus }) },
}));
vi.mock("@/services/connections", () => ({ saveConnection: h.saveConnection }));
vi.mock("@/services/identities", () => ({ saveIdentity: vi.fn(async () => {}) }));
vi.mock("@/services/keys", () => ({ saveKey: vi.fn(async () => {}) }));
vi.mock("@/services/folders", () => ({ saveFolder: vi.fn(async () => {}) }));
vi.mock("@/services/snippets", () => ({
  createSnippet: vi.fn(async () => {}), createSnippetFolder: vi.fn(async () => {}),
}));
vi.mock("@/services/portForwardingRules", () => ({ createPfRule: vi.fn(async () => {}) }));

import { VaultGeneralTab } from "./VaultsSection";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";

const ownerRole = {
  id: "r-own", team_id: "t1", name: "owner",
  is_builtin: true, permissions: 0, position: 0, created_at: "",
};

const detail = { kind: "local" as const, vaultId: "v1", teamId: "t1", name: "My Vault" };
const onBack = vi.fn();

const messages = () => h.addToast.mock.calls.map((c) => (c[0] as { message: string }).message);

/** Renders the tab and gets past the two-click confirm on "Make private". */
function clickMakePrivate() {
  render(<VaultGeneralTab detail={detail} onBack={onBack} onRenamed={vi.fn()} />);
  fireEvent.click(screen.getByText("settings.vaults.general.makePrivate.btn"));
  fireEvent.click(screen.getByText("settings.vaults.general.makePrivate.confirmBtn"));
}

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const fn of Object.values(h)) fn.mockReset();
  h.deleteTeam.mockResolvedValue(undefined);
  h.fetchTeamData.mockResolvedValue(undefined);
  h.reloadLocalVaultObjectStores.mockResolvedValue(undefined);
  h.saveConnection.mockResolvedValue(undefined);
  h.t.mockImplementation((k: string) => k);
  onBack.mockReset();
  useVaultStore.setState({ setVaultTeamId: h.setVaultTeamId });
  useTeamStore.setState({
    teams: [{ id: "t1", name: "My Vault", owner_id: "me", owner_tier: "teams", created_at: "", role_ids: ["r-own"] }],
    membersByTeam: { t1: [] },
    rolesByTeam: { t1: [ownerRole] },
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("a rejected entity write aborts before anything destructive and says so", async () => {
  h.saveConnection.mockRejectedValue(new Error("disk full"));

  clickMakePrivate();

  await waitFor(() => expect(messages()).toContain("settings.vaults.general.makePrivate.copyFailedToast"));
  expect(h.deleteTeam).not.toHaveBeenCalled();
  expect(h.setVaultTeamId).not.toHaveBeenCalled();
  expect(h.clearTeamConnections).not.toHaveBeenCalled();
  expect(onBack).not.toHaveBeenCalled();
  expect(h.addToast.mock.calls[0][0]).toMatchObject({ severity: "error" });
});

test("a failed team delete leaves the vault linked and never claims success", async () => {
  h.deleteTeam.mockRejectedValue(new Error("offline"));

  clickMakePrivate();

  await waitFor(() => expect(h.deleteTeam).toHaveBeenCalledWith("t1"));
  await waitFor(() => expect(messages()).toContain("settings.vaults.general.makePrivate.removeMembersFailedToast"));
  expect(h.setVaultTeamId).not.toHaveBeenCalled();
  expect(h.clearTeamConnections).not.toHaveBeenCalled();
  expect(messages()).not.toContain("settings.vaults.general.madePrivateToastEmpty");
  expect(onBack).not.toHaveBeenCalled();
  expect(h.addToast.mock.calls[0][0]).toMatchObject({ severity: "error" });
});

test("the happy path deletes the team, unlinks the vault and reports success", async () => {
  clickMakePrivate();

  await waitFor(() => expect(onBack).toHaveBeenCalled());
  expect(h.saveConnection).toHaveBeenCalledWith(expect.objectContaining({ name: "web", vault_id: "v1" }));
  expect(h.deleteTeam).toHaveBeenCalledWith("t1");
  expect(h.setVaultTeamId).toHaveBeenCalledWith("v1", null);
  expect(h.clearTeamConnections).toHaveBeenCalledWith("t1");
  expect(h.clearTeamKeyCache).toHaveBeenCalled();
  expect(messages()).toEqual(["settings.vaults.general.madePrivateToastEmpty"]);
});

test("an unexpected failure surfaces as an error toast, not just a console line", async () => {
  h.fetchTeamData.mockRejectedValue(new Error("boom"));

  clickMakePrivate();

  await waitFor(() => expect(messages()).toContain("settings.vaults.general.makePrivate.failedToast"));
  expect(h.deleteTeam).not.toHaveBeenCalled();
  expect(h.setVaultTeamId).not.toHaveBeenCalled();
});

test("a transport failure's raw URL never reaches the toast", async () => {
  // The reason is interpolated for this test only; every other test asserts on
  // bare keys.
  h.t.mockImplementation((k: string, vars?: { reason?: string }) =>
    vars?.reason ? `${k} | ${vars.reason}` : k);
  h.deleteTeam.mockRejectedValue(
    new Error("error sending request for url (http://v68-server:8080/v1/teams/a5c2d19d)"),
  );

  clickMakePrivate();

  await waitFor(() => expect(h.addToast).toHaveBeenCalled());
  const shown = messages().join(" ");
  expect(shown).toContain("settings.vaults.general.makePrivate.removeMembersFailedToast");
  expect(shown).not.toMatch(/http/i);
  expect(shown).not.toContain("v68-server");
});
