import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  deleteTeam: vi.fn(async (_id: string) => {}),
  addToast: vi.fn(),
  fetchTeamData: vi.fn(async (_id: string) => {}),
  clearTeamKeyCache: vi.fn(),
  reloadLocalVaultObjectStores: vi.fn(async () => {}),
  adoptConnection: vi.fn(async (_id: string, _c: unknown) => {}),
  clearTeamConnections: vi.fn(),
  setStatus: vi.fn(),
  setVaultTeamId: vi.fn(),
  t: vi.fn((k: string) => k),
}));

// Not a fn, so it lives outside `h`: the generic `for (const fn of
// Object.values(h)) fn.mockReset()` below assumes every entry is a mock.
const teamVaultState = vi.hoisted(() => ({
  unencryptedCountByTeamId: {} as Record<string, number>,
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
  connectionToFormData: (c: Record<string, unknown>) => {
    const { id: _id, ...rest } = c;
    return rest;
  },
  useConnectionStore: {
    getState: () => ({
      teamConnections: {
        t1: [{
          id: "c1", name: "web", host: "h", port: 22, username: "u",
          auth_type: "password", tags: [], identity_id: "i1", key_id: "k1", folder_id: "f1",
          notes: "prod box", jump_hosts: [{ id: "j1", connection_id: "c9" }],
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
  useTeamVaultStateStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ unencryptedCountByTeamId: teamVaultState.unencryptedCountByTeamId }),
    { getState: () => ({ setStatus: h.setStatus }) },
  ),
}));
vi.mock("@/services/connections", () => ({ adoptConnection: h.adoptConnection }));
vi.mock("@/services/identities", () => ({ adoptIdentity: vi.fn(async () => {}) }));
vi.mock("@/services/keys", () => ({ adoptKey: vi.fn(async () => {}) }));
vi.mock("@/services/folders", () => ({ adoptFolder: vi.fn(async () => {}) }));
vi.mock("@/services/snippets", () => ({
  adoptSnippet: vi.fn(async () => {}), adoptSnippetFolder: vi.fn(async () => {}),
}));
vi.mock("@/services/portForwardingRules", () => ({ adoptPfRule: vi.fn(async () => {}) }));

import { useVaultAdminActions } from "./useVaultAdminActions";
import type { VaultAdminTarget } from "./vaultAdminTarget";
import { useVaultStore } from "@/stores/vaultStore";
import { useTeamStore } from "@/stores/teamStore";

const ownerRole = {
  id: "r-own", team_id: "t1", name: "owner",
  is_builtin: true, permissions: 0, position: 0, created_at: "",
};

const target: VaultAdminTarget =
  { kind: "local", vaultId: "v1", teamId: "t1", name: "My Vault" };
const onDone = vi.fn();

function Probe() {
  const { makePrivate } = useVaultAdminActions(target, { onDone });
  return <button onClick={() => void makePrivate()}>go</button>;
}

/**
 * Fires make-private twice in one tick, the way Modal.tsx's Enter handler does:
 * it stopPropagation()s but never preventDefault()s, so a focused Confirm button
 * runs `onEnter` and its own native click before React re-renders `busy`.
 */
const doubled: Promise<void>[] = [];
function DoubleProbe() {
  const { makePrivate } = useVaultAdminActions(target, { onDone });
  return <button onClick={() => { doubled.push(makePrivate(), makePrivate()); }}>twice</button>;
}

/** Runs the already-confirmed make-private action. */
function clickMakePrivate() {
  render(<Probe />);
  fireEvent.click(screen.getByText("go"));
}

const messages = () => h.addToast.mock.calls.map((c) => (c[0] as { message: string }).message);

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  for (const fn of Object.values(h)) fn.mockReset();
  teamVaultState.unencryptedCountByTeamId = {};
  h.deleteTeam.mockResolvedValue(undefined);
  h.fetchTeamData.mockResolvedValue(undefined);
  h.reloadLocalVaultObjectStores.mockResolvedValue(undefined);
  h.adoptConnection.mockResolvedValue(undefined);
  h.t.mockImplementation((k: string) => k);
  onDone.mockReset();
  useVaultStore.setState({ setVaultTeamId: h.setVaultTeamId });
  useTeamStore.setState({
    teams: [{ id: "t1", name: "My Vault", owner_id: "me", owner_tier: "teams", created_at: "", role_ids: ["r-own"] }],
    membersByTeam: { t1: [] },
    rolesByTeam: { t1: [ownerRole] },
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

test("a rejected entity write aborts before anything destructive and says so", async () => {
  h.adoptConnection.mockRejectedValue(new Error("disk full"));

  clickMakePrivate();

  await waitFor(() => expect(messages()).toContain("settings.vaults.general.makePrivate.copyFailedToast"));
  expect(h.deleteTeam).not.toHaveBeenCalled();
  expect(h.setVaultTeamId).not.toHaveBeenCalled();
  expect(h.clearTeamConnections).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
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
  expect(onDone).not.toHaveBeenCalled();
  expect(h.addToast.mock.calls[0][0]).toMatchObject({ severity: "error" });
});

test("the happy path deletes the team, unlinks the vault and reports success", async () => {
  clickMakePrivate();

  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(h.adoptConnection).toHaveBeenCalledWith("c1", expect.objectContaining({ name: "web", vault_id: "v1" }));
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

test("a copied object keeps its own id and its every field", async () => {
  clickMakePrivate();

  await waitFor(() => expect(onDone).toHaveBeenCalled());
  // A fresh id would orphan `password:c1` in the keychain and break every
  // reference to it, so the id is the assertion — not just that a write happened.
  const [id, payload] = h.adoptConnection.mock.calls[0] as [string, Record<string, unknown>];
  expect(id).toBe("c1");
  expect(payload).toMatchObject({
    vault_id: "v1",
    identity_id: "i1",
    key_id: "k1",
    folder_id: "f1",
    notes: "prod box",
    jump_hosts: [{ id: "j1", connection_id: "c9" }],
  });
});

test("a second confirm in the same tick is a no-op, not a second pass", async () => {
  // Asserted on timing, not call counts: an unguarded second call dies somewhere
  // in the concurrent dynamic-import race, so `deleteTeam`/`fetchTeamData` counts
  // read the same with the guard and without it. What only the guard produces is
  // a second call that settles *before its first await* — while the first is
  // still inside the copy pass, held here by a fetch that never resolves.
  h.fetchTeamData.mockReturnValue(new Promise<void>(() => {}));
  doubled.length = 0;
  render(<DoubleProbe />);

  fireEvent.click(screen.getByText("twice"));
  const settled = [false, false];
  doubled.forEach((p, i) => void p.then(() => { settled[i] = true; }));

  // Let the first call run its import chain and reach the fetch that never
  // resolves; a second call that was not turned away would get there too.
  await waitFor(() => expect(h.fetchTeamData).toHaveBeenCalled());
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));

  expect(doubled).toHaveLength(2);
  expect(settled[1]).toBe(true);
  expect(settled[0]).toBe(false);
  // A second pass that got as far as running would show up as either a second
  // copy attempt or the error toast its own failure raises.
  expect(h.fetchTeamData).toHaveBeenCalledTimes(1);
  expect(h.addToast).not.toHaveBeenCalled();
});
