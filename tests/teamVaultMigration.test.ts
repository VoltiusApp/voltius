import test from "node:test";
import assert from "node:assert/strict";
import { movedIntoTeamVault } from "../src/services/teamVaultMigration.ts";

const isTeamVaultId = (vaultId: string | null | undefined) => vaultId === "team-1";

test("detects personal host move into a team vault", () => {
  assert.equal(movedIntoTeamVault("personal", "team-1", isTeamVaultId), true);
  assert.equal(movedIntoTeamVault(undefined, "team-1", isTeamVaultId), true);
});

test("does not treat existing team updates as local-to-team moves", () => {
  assert.equal(movedIntoTeamVault("team-1", "team-1", isTeamVaultId), false);
  assert.equal(movedIntoTeamVault("personal", "personal", isTeamVaultId), false);
});
