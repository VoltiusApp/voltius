import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  deleteTeam: vi.fn(async (_id: string) => {}),
  renameTeam: vi.fn(async (_id: string, _name: string) => {}),
  loadTeams: vi.fn(async () => {}),
  renameVault: vi.fn(),
  markSelfDeparture: vi.fn(),
  addToast: vi.fn(),
  fetchTeamData: vi.fn(async (_id: string) => {}),
  listTeamObjects: vi.fn(async (_id: string) => [] as unknown[]),
  clearTeamKeyCache: vi.fn(),
  reloadLocalVaultObjectStores: vi.fn(async () => {}),
  adoptConnection: vi.fn(async (_id: string, _c: unknown) => {}),
  clearTeamConnections: vi.fn(),
  setStatus: vi.fn(),
  setVaultTeamId: vi.fn(),
  deleteVaultWithContents: vi.fn(async (_id: string) => {}),
  t: vi.fn((k: string) => k),
}));

// Not a fn, so it lives outside `h`: the generic `for (const fn of
// Object.values(h)) fn.mockReset()` below assumes every entry is a mock.
const teamVaultState = vi.hoisted(() => ({
  unencryptedCountByTeamId: {} as Record<string, number>,
  credentialsUnavailableByTeamId: {} as Record<string, boolean>,
  statusByTeamId: {} as Record<string, string>,
  disk: new Map<string, string>(),
  failLocalWrites: false,
  localConnections: [] as { id: string }[],
  teamConnections: {} as Record<string, unknown[]>,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.t }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args?: { key: string; value: string }) => {
    if (cmd === "secrets_get") return teamVaultState.disk.get(args!.key) ?? null;
    if (cmd === "secrets_set") {
      if (teamVaultState.failLocalWrites) throw new Error("disk full");
      teamVaultState.disk.set(args!.key, args!.value);
    }
    return null;
  }),
}));
vi.mock("@/services/teamService", () => ({
  deleteTeam: h.deleteTeam,
  renameTeam: h.renameTeam,
  searchUsers: vi.fn(async () => []),
  getMyUserId: vi.fn(async () => "me"),
  inviteByEmail: vi.fn(),
  listPendingInvitations: vi.fn(async () => []),
  revokePendingInvitation: vi.fn(),
}));
vi.mock("@/services/teamOffboarding", () => ({ markSelfDeparture: h.markSelfDeparture }));
vi.mock("@/hooks/useVaultContents", () => ({ useVaultContents: () => [] }));
vi.mock("@/hooks/useUIContributions", () => ({ useUIContributions: () => [] }));
vi.mock("@/components/shared/ContentCounts", () => ({ ContentCounts: () => null }));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn(async () => {}) }));
vi.mock("@/services/teamVaultActivation", () => ({ markTeamVaultLoadedAfterLocalActivation: vi.fn() }));
vi.mock("@/services/vaultTeamMigration", () => ({
  reloadLocalVaultObjectStores: async () => {
    teamVaultState.localConnections = [{ id: "c1" }];
    await h.reloadLocalVaultObjectStores();
  },
}));
vi.mock("@/services/vaultObjectStores", () => ({ deleteVaultWithContents: h.deleteVaultWithContents }));
vi.mock("@/services/teamObjects", () => ({ listTeamObjects: h.listTeamObjects }));
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
      connections: teamVaultState.localConnections,
      teamConnections: teamVaultState.teamConnections,
      clearTeamConnections: (teamId: string) => {
        teamVaultState.teamConnections = {};
        h.clearTeamConnections(teamId);
      },
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
    { getState: () => ({
      setStatus: h.setStatus,
      credentialsUnavailableByTeamId: teamVaultState.credentialsUnavailableByTeamId,
      statusByTeamId: teamVaultState.statusByTeamId,
    }) },
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
import { teamSecretCache } from "@/services/teamSecretCache";
import { getSecret, setVaultKey } from "@/services/vault";

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
  teamVaultState.credentialsUnavailableByTeamId = {};
  teamVaultState.statusByTeamId = { t1: "loaded" };
  teamVaultState.disk.clear();
  teamVaultState.failLocalWrites = false;
  teamVaultState.localConnections = [];
  teamVaultState.teamConnections = {
    t1: [{
      id: "c1", name: "web", host: "h", port: 22, username: "u",
      auth_type: "password", tags: [], identity_id: "i1", key_id: "k1", folder_id: "f1",
      notes: "prod box", jump_hosts: [{ id: "j1", connection_id: "c9" }],
    }],
  };
  teamSecretCache.clearAll();
  setVaultKey([1]);
  h.deleteTeam.mockResolvedValue(undefined);
  h.fetchTeamData.mockResolvedValue(undefined);
  h.listTeamObjects.mockResolvedValue([]);
  h.reloadLocalVaultObjectStores.mockResolvedValue(undefined);
  h.adoptConnection.mockResolvedValue(undefined);
  h.deleteVaultWithContents.mockResolvedValue(undefined);
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

test("the team's own store slices go with it", async () => {
  // The offboarding path used to drop these, and it no longer runs for a team
  // its owner deleted (#249); the roster the toast reports on is read first.
  useTeamStore.setState({
    membersByTeam: { t1: [{ user_id: "me" } as never, { user_id: "ana" } as never] },
  });

  clickMakePrivate();

  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(useTeamStore.getState().teams).toEqual([]);
  expect(useTeamStore.getState().membersByTeam.t1).toBeUndefined();
  expect(messages()).toEqual(["settings.vaults.general.madePrivateToast"]);
});

test("the delete is marked as this client's own before it is sent", async () => {
  // Unmarked, the server's echo of this delete reads as a kick: the wrong
  // notice, and an offboarding wipe aimed at the copies just adopted under the
  // same ids. Marking after the round trip would be too late (#249).
  clickMakePrivate();

  await waitFor(() => expect(h.deleteTeam).toHaveBeenCalled());
  expect(h.markSelfDeparture).toHaveBeenCalledWith("t1", "self-deleted");
  expect(h.markSelfDeparture.mock.invocationCallOrder[0])
    .toBeLessThan(h.deleteTeam.mock.invocationCallOrder[0]);
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

test("the vault's secrets survive make-private in the local store", async () => {
  teamSecretCache.set("t1", "password:c1", "pw");
  teamSecretCache.set("t1", "proxy_password:c1", "proxy");

  clickMakePrivate();

  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(teamVaultState.disk.get("password:c1")).toBe("pw");
  expect(teamSecretCache.entries("t1").size).toBe(0);
  expect(await getSecret("password:c1")).toBe("pw");
  expect(await getSecret("proxy_password:c1")).toBe("proxy");
});

test("a secret that cannot be copied locally aborts before the team is deleted", async () => {
  teamSecretCache.set("t1", "password:c1", "pw");
  teamVaultState.failLocalWrites = true;

  clickMakePrivate();

  await waitFor(() => expect(messages()).toContain("settings.vaults.general.makePrivate.copyFailedToast"));
  expect(h.deleteTeam).not.toHaveBeenCalled();
  expect(teamSecretCache.get("t1", "password:c1")).toBe("pw");
});

test("unavailable team credentials abort before the team is deleted", async () => {
  teamVaultState.credentialsUnavailableByTeamId = { t1: true };

  clickMakePrivate();

  await waitFor(() => expect(messages()).toContain("settings.vaults.general.makePrivate.copyFailedToast"));
  expect(h.deleteTeam).not.toHaveBeenCalled();
});

test.each(["error", "offline", "forbidden", "awaiting_key", "key_mismatch", "loading", undefined])(
  "a vault load ending in %s aborts before the team is deleted",
  async (status) => {
    teamVaultState.statusByTeamId = status ? { t1: status } : {};

    clickMakePrivate();

    await waitFor(() => expect(messages()).toContain("settings.vaults.general.makePrivate.copyFailedToast"));
    expect(h.adoptConnection).not.toHaveBeenCalled();
    expect(h.deleteTeam).not.toHaveBeenCalled();
    expect(h.markSelfDeparture).not.toHaveBeenCalled();
  },
);

test.each([
  ["a stale legacy blob marked loaded", "loaded"],
  ["a missing blob marked error", "error"],
])("a failing object list after %s aborts before the team is deleted", async (_case, status) => {
  teamVaultState.statusByTeamId = { t1: status };
  h.listTeamObjects.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));

  clickMakePrivate();

  await waitFor(() => expect(messages()).toContain("settings.vaults.general.makePrivate.copyFailedToast"));
  expect(h.adoptConnection).not.toHaveBeenCalled();
  expect(h.deleteTeam).not.toHaveBeenCalled();
});

test("make-private re-reads the object list itself rather than trusting a loaded status", async () => {
  clickMakePrivate();

  await waitFor(() => expect(h.deleteTeam).toHaveBeenCalled());
  expect(h.listTeamObjects).toHaveBeenCalledWith("t1");
  expect(h.listTeamObjects.mock.invocationCallOrder[0]).toBeLessThan(h.adoptConnection.mock.invocationCallOrder[0]);
});

const listed = (object_id: string, deleted_at?: string) =>
  ({ object_id, object_type: "connection", metadata: {}, updated_at: "", updated_by: "", deleted_at });

test("a listed object missing from the loaded stores aborts before anything is adopted or deleted", async () => {
  h.listTeamObjects.mockResolvedValue([listed("c1"), listed("c-created-after-blob")]);

  clickMakePrivate();

  await waitFor(() => expect(messages()).toContain("settings.vaults.general.makePrivate.copyFailedToast"));
  expect(h.adoptConnection).not.toHaveBeenCalled();
  expect(h.deleteTeam).not.toHaveBeenCalled();
});

test("every listed object present in the stores proceeds, ignoring deleted records", async () => {
  h.listTeamObjects.mockResolvedValue([listed("c1"), listed("c-gone", "2026-01-01T00:00:00Z")]);

  clickMakePrivate();

  await waitFor(() => expect(h.deleteTeam).toHaveBeenCalledWith("t1"));
  expect(h.adoptConnection).toHaveBeenCalledWith("c1", expect.anything());
});

function RenameProbe({ of }: { of: VaultAdminTarget }) {
  const { rename } = useVaultAdminActions(of);
  return <button onClick={() => rename("Ops")}>rename</button>;
}

test("renaming a team vault renames the team on the server, not a local copy", async () => {
  useVaultStore.setState({ renameVault: h.renameVault });
  useTeamStore.setState({ loadTeams: h.loadTeams });
  render(<RenameProbe of={target} />);
  fireEvent.click(screen.getByText("rename"));

  await waitFor(() => expect(h.loadTeams).toHaveBeenCalled());
  expect(h.renameTeam).toHaveBeenCalledWith("t1", "Ops");
  expect(h.renameVault).not.toHaveBeenCalled();
});

test("a refused team rename says so and changes nothing locally", async () => {
  useVaultStore.setState({ renameVault: h.renameVault });
  h.renameTeam.mockRejectedValue(new Error("403"));
  render(<RenameProbe of={target} />);
  fireEvent.click(screen.getByText("rename"));

  await waitFor(() => expect(messages()).toContain("settings.vaults.general.renameFailedToast"));
  expect(h.renameVault).not.toHaveBeenCalled();
});

test("renaming a private vault stays local", () => {
  useVaultStore.setState({ renameVault: h.renameVault });
  render(<RenameProbe of={{ kind: "local", vaultId: "v2", teamId: null, name: "Mine" }} />);
  fireEvent.click(screen.getByText("rename"));

  expect(h.renameVault).toHaveBeenCalledWith("v2", "Ops");
  expect(h.renameTeam).not.toHaveBeenCalled();
});

function DeleteProbe({ of }: { of: VaultAdminTarget }) {
  const { remove } = useVaultAdminActions(of, { onDone });
  return <button onClick={() => void remove()}>delete</button>;
}

test("deleting a private vault sweeps it locally and never touches the server", async () => {
  render(<DeleteProbe of={{ kind: "local", vaultId: "v2", teamId: null, name: "Mine" }} />);
  fireEvent.click(screen.getByText("delete"));

  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(h.deleteVaultWithContents).toHaveBeenCalledWith("v2");
  expect(h.deleteTeam).not.toHaveBeenCalled();
});

test("deleting a linked team vault deletes the team, then its local record", async () => {
  render(<DeleteProbe of={target} />);
  fireEvent.click(screen.getByText("delete"));

  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(h.markSelfDeparture).toHaveBeenCalledWith("t1", "leave");
  expect(h.markSelfDeparture.mock.invocationCallOrder[0])
    .toBeLessThan(h.deleteTeam.mock.invocationCallOrder[0]);
  expect(h.deleteTeam).toHaveBeenCalledWith("t1");
  expect(h.deleteTeam.mock.invocationCallOrder[0])
    .toBeLessThan(h.deleteVaultWithContents.mock.invocationCallOrder[0]);
  expect(h.deleteVaultWithContents).toHaveBeenCalledWith("v1");
});

test("deleting a standalone team vault deletes the team and drops it from the selection", async () => {
  useVaultStore.setState({ selectedVaultIds: ["personal", "t1"] });
  render(<DeleteProbe of={{ kind: "cloud", vaultId: null, teamId: "t1", name: "Theirs" }} />);
  fireEvent.click(screen.getByText("delete"));

  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(h.deleteTeam).toHaveBeenCalledWith("t1");
  expect(h.deleteVaultWithContents).not.toHaveBeenCalled();
  expect(useVaultStore.getState().selectedVaultIds).toEqual(["personal"]);
});

test("a refused team delete keeps the local record and says nothing was deleted", async () => {
  h.deleteTeam.mockRejectedValue(new Error("403"));
  render(<DeleteProbe of={target} />);
  fireEvent.click(screen.getByText("delete"));

  await waitFor(() => expect(messages()).toContain("settings.vaults.general.deleteVault.teamFailedToast"));
  expect(h.deleteVaultWithContents).not.toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
});
