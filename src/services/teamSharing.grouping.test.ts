import { test, expect } from "vitest";
import { groupPeople } from "./teamSharing";

const mate = { user_id: "m1", display_name: "Zoe", handle: "quiet-otter-1", teamIds: ["t1"], team_id: "t1" };
const recent = { user_id: "r1", handle: "kevin-p", display_name: "Kevin", last_invited_at: "2026-08-15T00:00:00.000Z" };
const strangerHit = { user_id: "s1", display_name: "Sam", handle: "sam-q", is_teammate: false };
const mateHit = { user_id: "m1", display_name: "Zoe", handle: "quiet-otter-1", is_teammate: true };

test("with no query, recent and teammates show and strangers do not", () => {
  const g = groupPeople({ query: "", teammates: [mate], recent: [recent], results: [] });
  expect(g.recent.map((p) => p.user_id)).toEqual(["r1"]);
  expect(g.teammates.map((p) => p.user_id)).toEqual(["m1"]);
  expect(g.strangers).toEqual([]);
});

test("typing filters recent and teammates locally and adds the stranger group", () => {
  const g = groupPeople({ query: "sam", teammates: [mate], recent: [recent], results: [strangerHit, mateHit] });
  expect(g.recent).toEqual([]);
  expect(g.teammates).toEqual([]);
  expect(g.strangers.map((p) => p.user_id)).toEqual(["s1"]);
});

test("a search hit that is already a teammate or already in recent is not repeated as a stranger", () => {
  const g = groupPeople({ query: "zo", teammates: [mate], recent: [recent], results: [mateHit] });
  expect(g.teammates.map((p) => p.user_id)).toEqual(["m1"]);
  expect(g.strangers).toEqual([]);
});

test("a person in both Recent and Your teams appears once, under Recent", () => {
  const recentMate = { user_id: "m1", handle: "quiet-otter-1", display_name: "Zoe", last_invited_at: "2026-08-15T00:00:00.000Z" };
  const g = groupPeople({ query: "", teammates: [mate], recent: [recentMate], results: [] });
  expect(g.recent.map((p) => p.user_id)).toEqual(["m1"]);
  expect(g.teammates).toEqual([]);
});
