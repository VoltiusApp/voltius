import { test, expect, beforeEach, describe } from "vitest";

import {
  isTeamVaultId,
  upsertById,
  findTeamEntry,
  setTeamMapEntry,
  clearTeamMapEntry,
  upsertInTeamMap,
  removeFromTeamMap,
  applyVaultTransition,
} from "./teamVaultMap";
import { useTeamStore } from "./teamStore";

const item = (id: string, name = id) => ({ id, name });

beforeEach(() => {
  useTeamStore.setState({ teams: [{ id: "team-a" }, { id: "team-b" }] as never });
});

describe("isTeamVaultId", () => {
  test("recognises a loaded team id", () => {
    expect(isTeamVaultId("team-a")).toBe(true);
  });

  test("rejects the personal vault, unknown ids and empty values", () => {
    expect(isTeamVaultId("personal")).toBe(false);
    expect(isTeamVaultId("team-c")).toBe(false);
    expect(isTeamVaultId(null)).toBe(false);
    expect(isTeamVaultId(undefined)).toBe(false);
    expect(isTeamVaultId("")).toBe(false);
  });
});

describe("upsertById", () => {
  test("appends an unknown id", () => {
    expect(upsertById([item("a")], item("b"))).toEqual([item("a"), item("b")]);
  });

  test("replaces in place, keeping position", () => {
    const next = upsertById([item("a"), item("b"), item("c")], item("b", "renamed"));
    expect(next.map((x) => x.id)).toEqual(["a", "b", "c"]);
    expect(next[1].name).toBe("renamed");
  });

  test("does not mutate the input array", () => {
    const arr = [item("a")];
    upsertById(arr, item("b"));
    expect(arr).toHaveLength(1);
  });
});

describe("findTeamEntry", () => {
  test("returns the owning team and the item", () => {
    const map = { "team-a": [item("a")], "team-b": [item("b")] };
    expect(findTeamEntry(map, "b")).toEqual({ teamId: "team-b", item: item("b") });
  });

  test("returns null when no vault holds the id", () => {
    expect(findTeamEntry({ "team-a": [item("a")] }, "z")).toBeNull();
  });
});

describe("map entries", () => {
  test("setTeamMapEntry replaces one vault's list", () => {
    const map = setTeamMapEntry({ "team-a": [item("a")] }, "team-a", [item("z")]);
    expect(map["team-a"]).toEqual([item("z")]);
  });

  test("clearTeamMapEntry drops one vault, or all of them without an id", () => {
    const map = { "team-a": [item("a")], "team-b": [item("b")] };
    expect(Object.keys(clearTeamMapEntry(map, "team-a"))).toEqual(["team-b"]);
    expect(clearTeamMapEntry(map)).toEqual({});
  });

  test("upsertInTeamMap seeds a vault that has no list yet", () => {
    expect(upsertInTeamMap({}, "team-a", item("a"))).toEqual({ "team-a": [item("a")] });
  });

  test("removeFromTeamMap leaves an empty list rather than deleting the key", () => {
    expect(removeFromTeamMap({ "team-a": [item("a")] }, "team-a", "a")).toEqual({ "team-a": [] });
  });
});

describe("applyVaultTransition", () => {
  const map = { "team-a": [item("x")], "team-b": [] };

  test("local-to-team upserts into the destination", () => {
    const next = applyVaultTransition({}, { kind: "local-to-team", destinationTeamId: "team-a" }, "x", item("x"));
    expect(next["team-a"]).toEqual([item("x")]);
  });

  test("team-to-team moves the object across", () => {
    const next = applyVaultTransition(
      map, { kind: "team-to-team", sourceTeamId: "team-a", destinationTeamId: "team-b" }, "x", item("x", "moved"),
    );
    expect(next["team-a"]).toEqual([]);
    expect(next["team-b"]).toEqual([item("x", "moved")]);
  });

  test("team-to-local only removes from the source", () => {
    const next = applyVaultTransition(map, { kind: "team-to-local", sourceTeamId: "team-a" }, "x", item("x"));
    expect(next["team-a"]).toEqual([]);
    expect(next["team-b"]).toEqual([]);
  });

  test("same-scope upserts into stayTeamId on a team branch", () => {
    const next = applyVaultTransition(map, { kind: "same-scope" }, "x", item("x", "renamed"), "team-a");
    expect(next["team-a"]).toEqual([item("x", "renamed")]);
  });

  test("same-scope without a stayTeamId returns the map untouched", () => {
    expect(applyVaultTransition(map, { kind: "same-scope" }, "x", item("x", "renamed"))).toBe(map);
  });
});
