import test from "node:test";
import assert from "node:assert/strict";
import { markTeamVaultLoadedAfterLocalActivation } from "../src/services/teamVaultActivation.ts";

test("local team vault activation marks the vault loaded", () => {
  const calls: Array<[string, string]> = [];

  markTeamVaultLoadedAfterLocalActivation("team-a", {
    setStatus: (teamId, status) => { calls.push([teamId, status]); },
  });

  assert.deepEqual(calls, [["team-a", "loaded"]]);
});
