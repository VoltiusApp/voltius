import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  fetchTeamData: vi.fn(async (_teamId: string) => {}),
  clearTeamKeyCache: vi.fn(),
  reconcileTeamVaultKeys: vi.fn(async (_teamId: string) => {}),
  drainPendingSecretWipes: vi.fn(async () => {}),
  checkAndRotateTeamKey: vi.fn(async (_teamId: string) => {}),
  teams: [] as { id: string }[],
  saveTeamVaultObject: vi.fn(async () => {}),
}));

vi.mock("@/services/teamVaultSync", () => ({
  fetchTeamData: h.fetchTeamData,
  clearTeamKeyCache: h.clearTeamKeyCache,
  reconcileTeamVaultKeys: h.reconcileTeamVaultKeys,
  drainPendingSecretWipes: h.drainPendingSecretWipes,
}));
vi.mock("@/services/teamKeyRotation", () => ({
  checkAndRotateTeamKey: h.checkAndRotateTeamKey,
}));
vi.mock("@/stores/teamStore", () => ({
  useTeamStore: { getState: () => ({ teams: h.teams }) },
}));

vi.mock("@/services/teamObjectPersistence", () => ({
  saveTeamVaultObject: h.saveTeamVaultObject,
  removeTeamVaultObject: vi.fn(async () => {}),
}));

import { onTeamLogin, onSessionEnd } from "./teamDataManager";
import { useHistoryStore } from "@/stores/historyStore";
import { pushTeamDeleteHistory } from "@/stores/recreateHistory";

beforeEach(() => {
  vi.clearAllMocks();
  h.teams = [];
});

// #217: the realtime team_members handler (sync.ts) is the only other place
// rotation gets checked. A client offline when a member was removed never
// receives that event, so login must also check — otherwise the team stays
// permanently un-rotated / stuck draining until some unrelated event fires.
test("onTeamLogin checks rotation for every team the user belongs to", async () => {
  h.teams = [{ id: "t1" }, { id: "t2" }];

  await onTeamLogin();

  expect(h.checkAndRotateTeamKey.mock.calls.map((c) => c[0]).sort()).toEqual(["t1", "t2"]);
});

test("a rotation-check failure for one team does not block the others (allSettled)", async () => {
  h.teams = [{ id: "t1" }, { id: "t2" }];
  h.checkAndRotateTeamKey.mockImplementation(async (teamId: string) => {
    if (teamId === "t1") throw new Error("offline");
  });

  await expect(onTeamLogin()).resolves.toBeUndefined();

  expect(h.checkAndRotateTeamKey).toHaveBeenCalledWith("t2");
});

test("session end drops every cached team secret", async () => {
  const { teamSecretCache } = await import("@/services/teamSecretCache");
  teamSecretCache.set("t1", "password:c1", "pw");
  onSessionEnd();
  expect(teamSecretCache.get("t1", "password:c1")).toBeUndefined();
});

test("session end drops undo history, so a team delete holding secrets can no longer be undone", async () => {
  const { teamSecretCache } = await import("@/services/teamSecretCache");
  teamSecretCache.set("t1", "password:c1", "pw");
  const putBack = vi.fn();
  pushTeamDeleteHistory({ label: "del", teamId: "t1", type: "connection", item: { id: "c1" }, putBack, remove: async () => {} });
  expect(useHistoryStore.getState().past).toHaveLength(1);
  onSessionEnd();
  expect(useHistoryStore.getState()).toMatchObject({ past: [], future: [], canUndo: false, canRedo: false });
  await useHistoryStore.getState().undo();
  expect(h.saveTeamVaultObject).not.toHaveBeenCalled();
  expect(putBack).not.toHaveBeenCalled();
});
