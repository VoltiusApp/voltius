import { test, expect } from "vitest";
import { parseMembershipChangedEvent, getTeamMembershipDelta } from "@/services/teamMembershipEvents";

test("parses an added event", () => {
  expect(parseMembershipChangedEvent("membership_changed:added:team-1")).toEqual({
    kind: "added",
    teamId: "team-1",
  });
});

test("parses a removed event", () => {
  expect(parseMembershipChangedEvent("membership_changed:removed:team-1")).toEqual({
    kind: "removed",
    teamId: "team-1",
  });
});

test("returns null for the bare legacy event", () => {
  expect(parseMembershipChangedEvent("membership_changed")).toBeNull();
});

test("returns null for an unrecognized kind", () => {
  expect(parseMembershipChangedEvent("membership_changed:renamed:team-1")).toBeNull();
});

test("returns null for an unrelated event", () => {
  expect(parseMembershipChangedEvent("team_members:team-1")).toBeNull();
});

test("computes added and removed team ids", () => {
  expect(getTeamMembershipDelta(["a", "b"], ["b", "c"])).toEqual({
    added: ["c"],
    removed: ["a"],
  });
});
