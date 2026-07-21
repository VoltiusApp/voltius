import { test, expect } from "vitest";
import {
  classifyVaultTransition,
  movedIntoTeamVault,
  migrateVaultObject,
} from "./teamVaultMigration.ts";

// Team vaults are the ids starting with "team-" for these tests.
const isTeam = (id: string | null | undefined) => !!id && id.startsWith("team-");

test("classifyVaultTransition: same local scope", () => {
  expect(classifyVaultTransition("personal", "personal", isTeam)).toEqual({ kind: "same-scope" });
  expect(classifyVaultTransition(null, undefined, isTeam)).toEqual({ kind: "same-scope" });
});

test("classifyVaultTransition: local → team", () => {
  expect(classifyVaultTransition("personal", "team-a", isTeam)).toEqual({
    kind: "local-to-team", destinationTeamId: "team-a",
  });
});

test("classifyVaultTransition: team → team (distinct ids only)", () => {
  expect(classifyVaultTransition("team-a", "team-b", isTeam)).toEqual({
    kind: "team-to-team", sourceTeamId: "team-a", destinationTeamId: "team-b",
  });
  // same team id is not a transition
  expect(classifyVaultTransition("team-a", "team-a", isTeam)).toEqual({ kind: "same-scope" });
});

test("classifyVaultTransition: team → local", () => {
  expect(classifyVaultTransition("team-a", "personal", isTeam)).toEqual({
    kind: "team-to-local", sourceTeamId: "team-a",
  });
});

test("movedIntoTeamVault: true only for local→team", () => {
  expect(movedIntoTeamVault("personal", "team-a", isTeam)).toBe(true);
  expect(movedIntoTeamVault("team-a", "team-b", isTeam)).toBe(false);
  expect(movedIntoTeamVault("team-a", "personal", isTeam)).toBe(false);
});

test("migrateVaultObject: local→team updates local then saves to team", async () => {
  const calls: string[] = [];
  const item = { id: "x1", vault_id: "personal" };
  const updated = { id: "x1", vault_id: "team-a" };
  const result = await migrateVaultObject({
    previousVaultId: "personal", nextVaultId: "team-a", isTeamVaultId: isTeam, item,
    updateLocal: async () => { calls.push("updateLocal"); return updated; },
    saveTeam: async (teamId) => { calls.push(`saveTeam:${teamId}`); },
    removeTeam: async () => { calls.push("removeTeam"); },
  });
  expect(result).toEqual(updated);
  expect(calls).toEqual(["updateLocal", "saveTeam:team-a"]);
});

test("migrateVaultObject: team→team saves to dest then removes from source", async () => {
  const calls: string[] = [];
  const item = { id: "x1", vault_id: "team-a" };
  const result = await migrateVaultObject({
    previousVaultId: "team-a", nextVaultId: "team-b", isTeamVaultId: isTeam, item,
    updateLocal: async () => { calls.push("updateLocal"); return item; },
    saveTeam: async (teamId) => { calls.push(`saveTeam:${teamId}`); },
    removeTeam: async (teamId, id) => { calls.push(`removeTeam:${teamId}:${id}`); },
  });
  expect(result).toBe(item);
  expect(calls).toEqual(["saveTeam:team-b", "removeTeam:team-a:x1"]);
});

test("migrateVaultObject: team→local updates local then removes from source", async () => {
  const calls: string[] = [];
  const item = { id: "x1", vault_id: "team-a" };
  const updated = { id: "x1", vault_id: "personal" };
  const result = await migrateVaultObject({
    previousVaultId: "team-a", nextVaultId: "personal", isTeamVaultId: isTeam, item,
    updateLocal: async () => { calls.push("updateLocal"); return updated; },
    saveTeam: async () => { calls.push("saveTeam"); },
    removeTeam: async (teamId, id) => { calls.push(`removeTeam:${teamId}:${id}`); },
  });
  expect(result).toEqual(updated);
  expect(calls).toEqual(["updateLocal", "removeTeam:team-a:x1"]);
});

test("migrateVaultObject: same-scope into a team vault still saves to team", async () => {
  const calls: string[] = [];
  const item = { id: "x1", vault_id: "team-a" };
  const result = await migrateVaultObject({
    previousVaultId: "team-a", nextVaultId: "team-a", isTeamVaultId: isTeam, item,
    updateLocal: async () => { calls.push("updateLocal"); return item; },
    saveTeam: async (teamId) => { calls.push(`saveTeam:${teamId}`); },
    removeTeam: async () => { calls.push("removeTeam"); },
  });
  expect(result).toBe(item);
  expect(calls).toEqual(["saveTeam:team-a"]);
});

test("migrateVaultObject: same-scope local just updates local", async () => {
  const calls: string[] = [];
  const item = { id: "x1", vault_id: "personal" };
  await migrateVaultObject({
    previousVaultId: "personal", nextVaultId: "personal", isTeamVaultId: isTeam, item,
    updateLocal: async () => { calls.push("updateLocal"); return item; },
    saveTeam: async () => { calls.push("saveTeam"); },
    removeTeam: async () => { calls.push("removeTeam"); },
  });
  expect(calls).toEqual(["updateLocal"]);
});
