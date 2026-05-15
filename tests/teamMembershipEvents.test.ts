import test from "node:test";
import assert from "node:assert/strict";
import {
  getTeamMembershipDelta,
  handleMembershipChangedEvent,
} from "../src/services/teamMembershipEvents.ts";

test("membership event detects added and removed teams", () => {
  assert.deepEqual(getTeamMembershipDelta(["team-a", "team-b"], ["team-b", "team-c"]), {
    added: ["team-c"],
    removed: ["team-a"],
  });
});

test("membership event runs setup for newly added teams after reloading teams", async () => {
  let teamIds = ["team-a"];
  const added: string[] = [];

  await handleMembershipChangedEvent({
    getTeamIds: () => teamIds,
    loadTeams: async () => { teamIds = ["team-a", "team-b"]; },
    onTeamAdded: async (teamId) => { added.push(teamId); },
  });

  assert.deepEqual(added, ["team-b"]);
});
