import { test, expect, vi } from "vitest";
import { handleMembershipChangedEvent, getTeamMembershipDelta } from "./teamMembershipEvents";

test("reports the teams added and removed between two snapshots", () => {
  expect(getTeamMembershipDelta(["a", "b"], ["b", "c"])).toEqual({ added: ["c"], removed: ["a"] });
});

test("onTeamRemoved fires only after loadTeams has already dropped the team", async () => {
  // The ordering this pins is not cosmetic: a caller that waits until
  // onTeamRemoved to look up the departed team's *name* finds it gone and falls
  // back to the raw id. A live two-account run caught exactly that — the removal
  // notice read "You were removed from <uuid>". Names must be snapshotted before
  // handleMembershipChangedEvent runs.
  const store = { teams: [{ id: "t1", name: "Platform" }] };
  const namesWhenRemovedFired: Array<string | undefined> = [];

  await handleMembershipChangedEvent({
    getTeamIds: () => store.teams.map((t) => t.id),
    loadTeams: async () => { store.teams = []; },
    onTeamRemoved: (tid) => {
      namesWhenRemovedFired.push(store.teams.find((t) => t.id === tid)?.name);
    },
  });

  expect(namesWhenRemovedFired).toEqual([undefined]);
});

test("a name snapshot taken before the call survives into onTeamRemoved", async () => {
  const store = { teams: [{ id: "t1", name: "Platform" }] };
  const namesBefore = new Map(store.teams.map((t) => [t.id, t.name] as const));
  const seen: string[] = [];

  await handleMembershipChangedEvent({
    getTeamIds: () => store.teams.map((t) => t.id),
    loadTeams: async () => { store.teams = []; },
    onTeamRemoved: (tid) => { seen.push(namesBefore.get(tid) ?? tid); },
  });

  expect(seen).toEqual(["Platform"]);
});

test("a transient loadTeams failure is retried rather than read as no change", async () => {
  const store = { teams: [{ id: "t1", name: "Platform" }] };
  let attempt = 0;
  const onTeamRemoved = vi.fn();

  await handleMembershipChangedEvent({
    getTeamIds: () => store.teams.map((t) => t.id),
    loadTeams: async () => { if (++attempt >= 2) store.teams = []; },
    onTeamRemoved,
  });

  expect(attempt).toBeGreaterThan(1);
  expect(onTeamRemoved).toHaveBeenCalledWith("t1");
});
