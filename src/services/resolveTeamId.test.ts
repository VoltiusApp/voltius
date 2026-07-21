import { test, expect } from "vitest";
import { resolveTeamIdFromCollections } from "./resolveTeamId.ts";

test("null/undefined/empty vaultId → null", () => {
  expect(resolveTeamIdFromCollections(null, [], [])).toBeNull();
  expect(resolveTeamIdFromCollections(undefined, [], [])).toBeNull();
  expect(resolveTeamIdFromCollections("", [], [])).toBeNull();
});

test("vaultId that is itself a team id maps to itself", () => {
  expect(resolveTeamIdFromCollections("t1", [{ id: "t1" }], [])).toBe("t1");
});

test("non-team vault maps to its backing teamId", () => {
  expect(resolveTeamIdFromCollections("v1", [], [{ id: "v1", teamId: "t9" }])).toBe("t9");
});

test("vault without teamId → null", () => {
  expect(resolveTeamIdFromCollections("v1", [], [{ id: "v1" }])).toBeNull();
});

test("unknown vaultId → null", () => {
  expect(resolveTeamIdFromCollections("nope", [{ id: "t1" }], [{ id: "v1", teamId: "t1" }])).toBeNull();
});
