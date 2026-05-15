import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyVaultTransition,
  migrateVaultObject,
  movedIntoTeamVault,
} from "../src/services/teamVaultMigration.ts";

const isTeamVaultId = (vaultId: string | null | undefined) => vaultId === "team-1" || vaultId === "team-2";

test("detects personal host move into a team vault", () => {
  assert.equal(movedIntoTeamVault("personal", "team-1", isTeamVaultId), true);
  assert.equal(movedIntoTeamVault(undefined, "team-1", isTeamVaultId), true);
});

test("does not treat existing team updates as local-to-team moves", () => {
  assert.equal(movedIntoTeamVault("team-1", "team-1", isTeamVaultId), false);
  assert.equal(movedIntoTeamVault("personal", "personal", isTeamVaultId), false);
});

test("classifies local to team moves", () => {
  assert.deepEqual(classifyVaultTransition("personal", "team-1", isTeamVaultId), {
    kind: "local-to-team",
    destinationTeamId: "team-1",
  });
});

test("classifies team to team moves", () => {
  assert.deepEqual(classifyVaultTransition("team-1", "team-2", isTeamVaultId), {
    kind: "team-to-team",
    sourceTeamId: "team-1",
    destinationTeamId: "team-2",
  });
});

test("classifies team to local moves", () => {
  assert.deepEqual(classifyVaultTransition("team-1", "personal", isTeamVaultId), {
    kind: "team-to-local",
    sourceTeamId: "team-1",
  });
});

test("classifies same-scope updates", () => {
  assert.deepEqual(classifyVaultTransition("team-1", "team-1", isTeamVaultId), {
    kind: "same-scope",
  });
  assert.deepEqual(classifyVaultTransition("personal", undefined, isTeamVaultId), {
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

  assert.deepEqual(calls, ["update-local", "save-team:team-1:item-1"]);
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

  assert.deepEqual(calls, ["save-team:team-2:item-1", "remove-team:team-1:item-1"]);
});

test("migrates team objects to local before removing from team", async () => {
  const calls: string[] = [];
  const item = { id: "item-1", vault_id: "personal" };

  await migrateVaultObject({
    previousVaultId: "team-1",
    nextVaultId: "personal",
    isTeamVaultId,
    item,
    updateLocal: async () => { calls.push("update-local"); return item; },
    saveTeam: async (teamId, savedItem) => { calls.push(`save-team:${teamId}:${savedItem.id}`); },
    removeTeam: async (teamId, id) => { calls.push(`remove-team:${teamId}:${id}`); },
  });

  assert.deepEqual(calls, ["update-local", "remove-team:team-1:item-1"]);
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

  assert.deepEqual(calls, ["update-local"]);
});
