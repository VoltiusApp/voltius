import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyVaultTransition,
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
