import { test, expect } from "vitest";
import {
  classifyVaultTransition,
  migrateVaultObject,
  movedIntoTeamVault,
} from "../src/services/teamVaultMigration.ts";

const isTeamVaultId = (vaultId: string | null | undefined) => vaultId === "team-1" || vaultId === "team-2";

test("detects personal host move into a team vault", () => {
  expect(movedIntoTeamVault("personal", "team-1", isTeamVaultId)).toBe(true);
  expect(movedIntoTeamVault(undefined, "team-1", isTeamVaultId)).toBe(true);
});

test("does not treat existing team updates as local-to-team moves", () => {
  expect(movedIntoTeamVault("team-1", "team-1", isTeamVaultId)).toBe(false);
  expect(movedIntoTeamVault("personal", "personal", isTeamVaultId)).toBe(false);
});

test("classifies local to team moves", () => {
  expect(classifyVaultTransition("personal", "team-1", isTeamVaultId)).toEqual({
    kind: "local-to-team",
    destinationTeamId: "team-1",
  });
});

test("classifies team to team moves", () => {
  expect(classifyVaultTransition("team-1", "team-2", isTeamVaultId)).toEqual({
    kind: "team-to-team",
    sourceTeamId: "team-1",
    destinationTeamId: "team-2",
  });
});

test("classifies team to local moves", () => {
  expect(classifyVaultTransition("team-1", "personal", isTeamVaultId)).toEqual({
    kind: "team-to-local",
    sourceTeamId: "team-1",
  });
});

test("classifies same-scope updates", () => {
  expect(classifyVaultTransition("team-1", "team-1", isTeamVaultId)).toEqual({
    kind: "same-scope",
  });
  expect(classifyVaultTransition("personal", undefined, isTeamVaultId)).toEqual({
    kind: "same-scope",
  });
});

test("migrates local objects into a team after native update", async () => {
  const calls: string[] = [];
  const item = { id: "item-1", vault_id: "team-1" };

  await migrateVaultObject({
    previousVaultId: "personal",
    nextVaultId: "team-1",
    isTeamVaultId,
    item,
    updateLocal: async () => { calls.push("update-local"); return item; },
    saveTeam: async (teamId, savedItem) => { calls.push(`save-team:${teamId}:${savedItem.id}`); },
    removeTeam: async (teamId, id) => { calls.push(`remove-team:${teamId}:${id}`); },
  });

  expect(calls).toEqual(["update-local", "save-team:team-1:item-1"]);
});

test("migrates team objects between teams without local writes", async () => {
  const calls: string[] = [];
  const item = { id: "item-1", vault_id: "team-2" };

  await migrateVaultObject({
    previousVaultId: "team-1",
    nextVaultId: "team-2",
    isTeamVaultId,
    item,
    updateLocal: async () => { calls.push("update-local"); return item; },
    saveTeam: async (teamId, savedItem) => { calls.push(`save-team:${teamId}:${savedItem.id}`); },
    removeTeam: async (teamId, id) => { calls.push(`remove-team:${teamId}:${id}`); },
  });

  expect(calls).toEqual(["save-team:team-2:item-1", "remove-team:team-1:item-1"]);
});

// team-to-local adopts rather than updates: the object has no local row to update,
// and the adopt keeps its id so secrets and cross-references still resolve.
test("migrates team objects to local before removing from team", async () => {
  const calls: string[] = [];
  const item = { id: "item-1", vault_id: "personal" };

  await migrateVaultObject({
    previousVaultId: "team-1",
    nextVaultId: "personal",
    isTeamVaultId,
    item,
    updateLocal: async () => { calls.push("update-local"); return item; },
    adoptLocal: async () => { calls.push("adopt-local"); return item; },
    saveTeam: async (teamId, savedItem) => { calls.push(`save-team:${teamId}:${savedItem.id}`); },
    removeTeam: async (teamId, id) => { calls.push(`remove-team:${teamId}:${id}`); },
  });

  expect(calls).toEqual(["adopt-local", "remove-team:team-1:item-1"]);
});

test("same-scope helper updates local only for local objects", async () => {
  const calls: string[] = [];
  const item = { id: "item-1", vault_id: "personal" };

  await migrateVaultObject({
    previousVaultId: "personal",
    nextVaultId: "personal",
    isTeamVaultId,
    item,
    updateLocal: async () => { calls.push("update-local"); return item; },
    saveTeam: async (teamId, savedItem) => { calls.push(`save-team:${teamId}:${savedItem.id}`); },
    removeTeam: async (teamId, id) => { calls.push(`remove-team:${teamId}:${id}`); },
  });

  expect(calls).toEqual(["update-local"]);
});

test("cascade dependencies use the same local-to-team migration path", async () => {
  const calls: string[] = [];
  const key = { id: "key-1", vault_id: "team-1" };
  const identity = { id: "identity-1", vault_id: "team-1", key_id: "key-1" };
  const host = { id: "host-1", vault_id: "team-1", identity_id: "identity-1" };

  for (const item of [key, identity, host]) {
    await migrateVaultObject({
      previousVaultId: "personal",
      nextVaultId: "team-1",
      isTeamVaultId,
      item,
      updateLocal: async () => { calls.push(`update-local:${item.id}`); return item; },
      saveTeam: async (teamId, savedItem) => { calls.push(`save-team:${teamId}:${savedItem.id}`); },
      removeTeam: async (teamId, id) => { calls.push(`remove-team:${teamId}:${id}`); },
    });
  }

  expect(calls).toEqual([
    "update-local:key-1",
    "save-team:team-1:key-1",
    "update-local:identity-1",
    "save-team:team-1:identity-1",
    "update-local:host-1",
    "save-team:team-1:host-1",
  ]);
});
