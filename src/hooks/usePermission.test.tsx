import { test, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";

afterEach(cleanup);

const last = <T,>(a: T[]): T => a[a.length - 1];

type Snap = {
  myUserId: string;
  teams: unknown[];
  membersByTeam: unknown;
  rolesByTeam: unknown;
  vaults: unknown;
};

const h = vi.hoisted(() => ({
  getMyUserId: vi.fn(async () => "u1" as string | null),
  resolveCan: vi.fn((_snapshot: Snap, _permission: string, _vaultId: string): boolean => false),
}));

vi.mock("@/services/teamService", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  getMyUserId: h.getMyUserId,
}));
vi.mock("@/services/permissions", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  resolveCan: h.resolveCan,
}));

import { usePermissions } from "./usePermission";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";

const team = (id: string) => ({ id, role_ids: [] }) as never;

let loadTeams: ReturnType<typeof vi.fn>;
let loadMembers: ReturnType<typeof vi.fn>;
let loadRoles: ReturnType<typeof vi.fn>;

beforeEach(() => {
  h.getMyUserId.mockReset();
  h.getMyUserId.mockResolvedValue("u1");
  h.resolveCan.mockReset();
  h.resolveCan.mockReturnValue(false);
  loadTeams = vi.fn(async () => undefined);
  loadMembers = vi.fn(async () => undefined);
  loadRoles = vi.fn(async () => undefined);
  useTeamStore.setState({
    teams: [],
    membersByTeam: {},
    rolesByTeam: {},
    loadTeams,
    loadMembers,
    loadRoles,
  } as never);
  useVaultStore.setState({ vaults: [] } as never);
});

// ─── lazy-load orchestration ─────────────────────────────────────────────────

test("loads teams on mount when none are cached", () => {
  renderHook(() => usePermissions());
  expect(loadTeams).toHaveBeenCalledTimes(1);
  expect(loadMembers).not.toHaveBeenCalled();
  expect(loadRoles).not.toHaveBeenCalled();
});

test("loads members and roles for a team missing both, and does not reload teams", () => {
  useTeamStore.setState({ teams: [team("t1")] } as never);
  renderHook(() => usePermissions());
  expect(loadTeams).not.toHaveBeenCalled();
  expect(loadMembers).toHaveBeenCalledWith("t1");
  expect(loadRoles).toHaveBeenCalledWith("t1");
});

test("does not reload members/roles that are already cached", () => {
  useTeamStore.setState({
    teams: [team("t1")],
    membersByTeam: { t1: [] as never },
    rolesByTeam: { t1: [] as never },
  } as never);
  renderHook(() => usePermissions());
  expect(loadMembers).not.toHaveBeenCalled();
  expect(loadRoles).not.toHaveBeenCalled();
});

test("loads only the missing slice — roles when members are already cached", () => {
  useTeamStore.setState({
    teams: [team("t1")],
    membersByTeam: { t1: [] as never },
    rolesByTeam: {},
  } as never);
  renderHook(() => usePermissions());
  expect(loadMembers).not.toHaveBeenCalled();
  expect(loadRoles).toHaveBeenCalledWith("t1");
});

// ─── can() delegation to resolveCan ──────────────────────────────────────────

test("can() returns resolveCan's verdict", () => {
  const { result } = renderHook(() => usePermissions());
  h.resolveCan.mockReturnValue(true);
  expect(result.current("CONNECT", "v1")).toBe(true);
  h.resolveCan.mockReturnValue(false);
  expect(result.current("CONNECT", "v1")).toBe(false);
});

test("can() assembles the snapshot from the team and vault stores", () => {
  const members = { t1: [{ user_id: "u1" }] } as never;
  const roles = { t1: [{ id: "r1" }] } as never;
  const vaults = [{ id: "v1", teamId: "t1" }] as never;
  useTeamStore.setState({ teams: [team("t1")], membersByTeam: members, rolesByTeam: roles } as never);
  useVaultStore.setState({ vaults } as never);

  const { result } = renderHook(() => usePermissions());
  result.current("VIEW_SECRETS", "v1");

  const [snapshot, permission, vaultId] = last(h.resolveCan.mock.calls);
  expect(permission).toBe("VIEW_SECRETS");
  expect(vaultId).toBe("v1");
  expect(snapshot.membersByTeam).toBe(members);
  expect(snapshot.rolesByTeam).toBe(roles);
  expect(snapshot.vaults).toBe(vaults);
  expect(snapshot.teams).toHaveLength(1);
});

test("can() reads vaults from the store at call time, not render time", () => {
  const { result } = renderHook(() => usePermissions());
  // vault store mutates AFTER render — can() must see the new vaults
  const laterVaults = [{ id: "v9", teamId: "t9" }] as never;
  useVaultStore.setState({ vaults: laterVaults } as never);
  result.current("CONNECT", "v9");
  expect(last(h.resolveCan.mock.calls)[0].vaults).toBe(laterVaults);
});

// ─── getMyUserId wiring ──────────────────────────────────────────────────────

test("can() passes the resolved user id from getMyUserId once it loads", async () => {
  h.getMyUserId.mockResolvedValue("u1");
  const { result } = renderHook(() => usePermissions());
  await waitFor(() => {
    h.resolveCan.mockClear();
    result.current("CONNECT", "v1");
    expect(h.resolveCan.mock.calls[0]![0].myUserId).toBe("u1");
  });
});

test("can() passes an empty user id when getMyUserId resolves null", async () => {
  h.getMyUserId.mockResolvedValue(null);
  const { result } = renderHook(() => usePermissions());
  await waitFor(() => expect(h.getMyUserId).toHaveBeenCalled());
  result.current("CONNECT", "v1");
  expect(last(h.resolveCan.mock.calls)[0].myUserId).toBe("");
});
