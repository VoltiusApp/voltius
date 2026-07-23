import { describe, it, expect } from "vitest";
import {
  secretObjectId,
  filterEntityArrayJson,
  filterRemoteExcluded,
  collectExcludedIds,
} from "./syncExclusion";
import { mergeEntities, type TimestampedEntity } from "./crdt";

const ent = (id: string): TimestampedEntity => ({
  id,
  updated_at: "2026-07-20T00:00:00Z",
  clocks: {},
});

describe("secretObjectId", () => {
  it("extracts the 2nd colon-delimited token", () => {
    expect(secretObjectId("password:a")).toBe("a");
    expect(secretObjectId("key:a:private")).toBe("a");
  });
  it("returns null for keys with no id segment", () => {
    expect(secretObjectId("weird")).toBe(null);
  });
});

describe("filterEntityArrayJson", () => {
  it("drops excluded ids and re-serializes", () => {
    const out = filterEntityArrayJson(`[{"id":"a"},{"id":"b"}]`, new Set(["a"]));
    expect(JSON.parse(out)).toEqual([{ id: "b" }]);
  });
  it("returns the input unchanged when nothing matches", () => {
    const input = `[{"id":"a"}]`;
    expect(filterEntityArrayJson(input, new Set(["z"]))).toBe(input);
  });
  it("returns the input unchanged for non-array / bad JSON", () => {
    expect(filterEntityArrayJson(`{"id":"a"}`, new Set(["a"]))).toBe(`{"id":"a"}`);
    expect(filterEntityArrayJson(`not json`, new Set(["a"]))).toBe(`not json`);
  });
});

describe("filterRemoteExcluded", () => {
  const payload = {
    files: {
      "connections.json": `[{"id":"a"},{"id":"b"}]`,
      "settings.json": `{"theme":"dark"}`,
    },
    secrets: { "password:a": "pw", "key:a:private": "kp", "key:shared:private": "sk" },
    secret_clocks: { "password:a": "t", "key:shared:private": "t" },
  };

  it("removes excluded entities and their secrets from both maps, leaves others", () => {
    const out = filterRemoteExcluded(payload, ["a"], ["connections.json", "settings.json"]);
    expect(JSON.parse(out.files["connections.json"])).toEqual([{ id: "b" }]);
    expect(out.files["settings.json"]).toBe(`{"theme":"dark"}`); // untouched
    expect(out.secrets).not.toHaveProperty("password:a");
    expect(out.secrets).not.toHaveProperty("key:a:private");
    expect(out.secret_clocks).not.toHaveProperty("password:a"); // no tombstone
    expect(out.secrets).toHaveProperty("key:shared:private"); // non-excluded kept
    expect(out.secret_clocks).toHaveProperty("key:shared:private");
  });

  it("returns the payload unchanged when the excluded set is empty", () => {
    const out = filterRemoteExcluded(payload, [], ["connections.json"]);
    expect(out).toBe(payload);
  });

  it("does not mutate the input payload", () => {
    filterRemoteExcluded(payload, ["a"], ["connections.json"]);
    expect(JSON.parse(payload.files["connections.json"])).toEqual([{ id: "a" }, { id: "b" }]);
    expect(payload.secrets).toHaveProperty("password:a");
  });
});

describe("filterRemoteExcluded + mergeEntities — bidirectional guarantees", () => {
  it("does not resurrect a locally-deleted, excluded object from remote", () => {
    const localWithout: TimestampedEntity[] = []; // user deleted X locally
    const remotePayload = {
      files: { "connections.json": JSON.stringify([ent("X")]) },
      secrets: {},
      secret_clocks: {},
    };
    const filtered = filterRemoteExcluded(remotePayload, ["X"], ["connections.json"]);
    const remote: TimestampedEntity[] = JSON.parse(filtered.files["connections.json"]);
    const merged = mergeEntities(localWithout, remote);
    expect(merged.find((e) => e.id === "X")).toBeUndefined();
  });

  it("keeps the local copy of an excluded object and ignores a newer remote copy (no loss / no remote override)", () => {
    type Conn = TimestampedEntity & { name: string };
    const localX: Conn = {
      id: "X",
      name: "local",
      updated_at: "2026-07-20T00:00:00Z",
      clocks: { name: "2026-07-20T00:00:00Z" },
    };
    // Remote holds a NEWER copy of X that WOULD win LWW and overwrite `name` if not filtered out.
    const remoteX: Conn = {
      id: "X",
      name: "remote",
      updated_at: "2026-07-25T00:00:00Z",
      clocks: { name: "2026-07-25T00:00:00Z" },
    };
    const remotePayload = {
      files: { "connections.json": JSON.stringify([remoteX]) },
      secrets: {},
      secret_clocks: {},
    };
    const filtered = filterRemoteExcluded(remotePayload, ["X"], ["connections.json"]);
    const remote = JSON.parse(filtered.files["connections.json"]) as Conn[];
    expect(remote).toHaveLength(0); // matching remote copy was actually removed by the filter
    const merged = mergeEntities([localX], remote);
    const mergedX = merged.find((e) => e.id === "X");
    expect(mergedX).toBeDefined();
    expect(mergedX!.name).toBe("local"); // local value preserved; newer remote did NOT override
  });
});

describe("collectExcludedIds", () => {
  const isObjectSynced = (id: string, type: string) => {
    if (type === "identity") return false; // whole type disabled
    if (id === "c2") return false; // individually excluded
    return true;
  };
  it("collects per-type-disabled ids, per-object exclusions, and raw ids", () => {
    const out = collectExcludedIds(
      [
        { type: "connection", ids: ["c1", "c2"] },
        { type: "identity", ids: ["i1", "i2"] },
      ],
      isObjectSynced,
      ["raw1"],
    );
    expect(new Set(out)).toEqual(new Set(["c2", "i1", "i2", "raw1"]));
  });
});
