import { test, expect, vi, beforeEach } from "vitest";
import { PERM_BITS } from "@/services/permissions";

const h = vi.hoisted(() => ({
  teams: [] as { id: string }[],
  vaults: [] as { id: string; name: string; teamId?: string }[],
  byTeam: {} as Record<string, Record<string, { myPermissions: number }>>,
}));

vi.mock("@/services/teamService", () => ({ getMyUserId: async () => "u1" }));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: { getState: () => ({ teams: h.teams, membersByTeam: {}, rolesByTeam: {} }) },
}));
vi.mock("@/stores/vaultStore", () => ({ useVaultStore: { getState: () => ({ vaults: h.vaults }) } }));
vi.mock("@/stores/teamObjectAccessStore", () => ({
  useTeamObjectAccessStore: { getState: () => ({ byTeam: h.byTeam }) },
}));

import { canConnect } from "./permissionsFromStores";

beforeEach(() => {
  h.teams = [{ id: "t1" }];
  h.vaults = [{ id: "personal", name: "Personal" }, { id: "v-team", name: "Ops", teamId: "t1" }];
  h.byTeam = { t1: { open: { myPermissions: PERM_BITS.VIEW | PERM_BITS.CONNECT }, locked: { myPermissions: PERM_BITS.VIEW } } };
});

test("a personal host always connects", async () => {
  expect(await canConnect("personal", "anything")).toBe(true);
  expect(await canConnect(undefined, "anything")).toBe(true);
});

test("a team host follows the server's Connect bit, whether filed by team id or local vault id", async () => {
  expect(await canConnect("t1", "open")).toBe(true);
  expect(await canConnect("t1", "locked")).toBe(false);
  expect(await canConnect("v-team", "locked")).toBe(false);
});
