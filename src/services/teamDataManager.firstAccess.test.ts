import { test, expect, vi, beforeEach } from "vitest";
import { PERM_BITS } from "./permissions.ts";

const CONNECT_ONLY = PERM_BITS.CONNECT | PERM_BITS.START_TERMINAL_SESSION
  | PERM_BITS.JOIN_TERMINAL_SESSION | PERM_BITS.VIEW_TERMINAL_SESSIONS;

const h = vi.hoisted(() => ({
  fetchTeamData: vi.fn(async (_teamId: string) => {}),
  clearTeamKeyCache: vi.fn(),
  reconcileTeamVaultKeys: vi.fn(async () => {}),
  loadMembers: vi.fn(async () => {}),
  loadRoles: vi.fn(async () => {}),
  setActiveNav: vi.fn(),
  setHomeView: vi.fn(),
  statusByTeamId: {} as Record<string, string>,
  setStatus: vi.fn(),
  teams: [] as unknown[],
  rolesByTeam: {} as Record<string, unknown[]>,
  selectedVaultIds: [] as string[],
  vaults: [] as unknown[],
}));

vi.mock("@/services/teamVaultSync", () => ({
  fetchTeamData: h.fetchTeamData,
  clearTeamKeyCache: h.clearTeamKeyCache,
  reconcileTeamVaultKeys: h.reconcileTeamVaultKeys,
}));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: {
    getState: () => ({
      teams: h.teams, rolesByTeam: h.rolesByTeam,
      loadMembers: h.loadMembers, loadRoles: h.loadRoles,
    }),
  },
}));
vi.mock("@/stores/teamVaultStateStore", () => ({
  useTeamVaultStateStore: {
    getState: () => ({ statusByTeamId: h.statusByTeamId, setStatus: h.setStatus }),
  },
}));
vi.mock("@/stores/uiStore", () => ({
  useUIStore: { getState: () => ({ setActiveNav: h.setActiveNav, setHomeView: h.setHomeView }) },
}));
vi.mock("@/stores/vaultStore", () => ({
  useVaultStore: { getState: () => ({ selectedVaultIds: h.selectedVaultIds, vaults: h.vaults }) },
}));

import { refreshAwaitingKeyTeams, joinAndLoadTeamVault } from "./teamDataManager";

beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks keeps implementations — a status-flipping stub from an earlier
  // test would otherwise make the next one's vault load on its own.
  h.fetchTeamData.mockImplementation(async () => {});
  h.statusByTeamId = {};
  h.teams = [];
  h.rolesByTeam = {};
  h.selectedVaultIds = [];
  h.vaults = [];
});

function connectOnlyTeam(teamId: string) {
  h.teams = [{ id: teamId, role_ids: ["r1"] }];
  h.rolesByTeam = { [teamId]: [{ id: "r1", name: "connect-only", permissions: CONNECT_ONLY }] };
}

test("only teams still waiting on a key are re-read", async () => {
  h.statusByTeamId = { t1: "awaiting_key", t2: "loaded", t3: "offline", t4: "awaiting_key" };
  await refreshAwaitingKeyTeams();
  expect(h.fetchTeamData.mock.calls.map((c) => c[0])).toEqual(["t1", "t4"]);
});

test("the re-read is a foreground fetch, so the vault can reach loaded", async () => {
  h.statusByTeamId = { t1: "awaiting_key" };
  await refreshAwaitingKeyTeams();
  expect(h.fetchTeamData).toHaveBeenCalledWith("t1");
});

test("a vault that unlocks under the waiting panel lands on the role's surface", async () => {
  connectOnlyTeam("t1");
  h.selectedVaultIds = ["t1"];
  h.statusByTeamId = { t1: "awaiting_key" };
  h.fetchTeamData.mockImplementation(async () => { h.statusByTeamId.t1 = "loaded"; });

  await refreshAwaitingKeyTeams();

  expect(h.setActiveNav).toHaveBeenCalledWith("hosts");
  expect(h.setHomeView).toHaveBeenCalledWith(false);
});

test("a vault that unlocks off screen never steers the nav", async () => {
  connectOnlyTeam("t1");
  h.selectedVaultIds = ["other"];
  h.statusByTeamId = { t1: "awaiting_key" };
  h.fetchTeamData.mockImplementation(async () => { h.statusByTeamId.t1 = "loaded"; });

  await refreshAwaitingKeyTeams();

  expect(h.setActiveNav).not.toHaveBeenCalled();
});

test("a vault still waiting on its key does not steer the nav", async () => {
  connectOnlyTeam("t1");
  h.selectedVaultIds = ["t1"];
  h.statusByTeamId = { t1: "awaiting_key" };

  await refreshAwaitingKeyTeams();

  expect(h.setActiveNav).not.toHaveBeenCalled();
});

test("joining a vault that loads lands on the role's surface", async () => {
  connectOnlyTeam("t1");
  h.fetchTeamData.mockImplementation(async () => { h.statusByTeamId.t1 = "loaded"; });

  await joinAndLoadTeamVault("t1");

  expect(h.setActiveNav).toHaveBeenCalledWith("hosts");
});

test("joining a vault that stays keyless leaves the nav alone", async () => {
  connectOnlyTeam("t1");
  h.fetchTeamData.mockImplementation(async () => { h.statusByTeamId.t1 = "awaiting_key"; });

  await joinAndLoadTeamVault("t1");

  expect(h.setActiveNav).not.toHaveBeenCalled();
}, 20000);
