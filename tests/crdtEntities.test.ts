import { test, expect } from "vitest";
import { mergeEntities } from "../src/services/crdt.ts";
import type { TimestampedEntity } from "../src/services/crdt.ts";

interface Conn extends TimestampedEntity {
  name: string;
  host: string;
}

function conn(id: string, over: Partial<Conn> = {}): Conn {
  return { id, name: "", host: "", updated_at: "", clocks: {}, ...over };
}

// merge one entity present on both sides (drives mergeTwo)
function mergeOne(a: Conn, b: Conn): Conn {
  const [only] = mergeEntities([a], [b]);
  return only;
}

test("entity present on only one side is kept as-is", () => {
  const a = conn("1", { name: "a" });
  const b = conn("2", { name: "b" });
  const out = mergeEntities([a], [b]).sort((x, y) => x.id.localeCompare(y.id));
  expect(out).toEqual([a, b]);
});

test("per-field: the field with the higher clock wins", () => {
  const local = conn("1", { name: "old", host: "keep.me", clocks: { name: "2026-01-01T00:00:00Z", host: "2026-01-05T00:00:00Z" } });
  const remote = conn("1", { name: "new", host: "stale", clocks: { name: "2026-01-02T00:00:00Z", host: "2026-01-03T00:00:00Z" } });
  const merged = mergeOne(local, remote);
  expect(merged.name).toBe("new");   // remote clock newer for name
  expect(merged.host).toBe("keep.me"); // local clock newer for host
});

test("missing clock loses to any real timestamp", () => {
  const local = conn("1", { name: "typed", clocks: { name: "2026-01-01T00:00:00Z" } });
  const remote = conn("1", { name: "legacy", clocks: {} }); // no clock => ""
  expect(mergeOne(local, remote).name).toBe("typed");
  // reverse direction — same winner regardless of arg order
  expect(mergeOne(remote, local).name).toBe("typed");
});

test("equal clocks: the id tiebreak is unreachable via mergeEntities, so first-arg value is retained", () => {
  // mergeEntities only merges two entities that share an `id`, so `b.id > a.id` in
  // mergeTwo (crdt.ts:31,42) is always false on this path — the tiebreak reduces to
  // "keep the first (existing/local) value" on equal clocks. Pin that behavior here;
  // it also documents that the id-tiebreak branch is effectively dead via this entry point.
  const a = conn("id", { name: "A", clocks: { name: "2026-01-01T00:00:00Z" } });
  const b = conn("id", { name: "B", clocks: { name: "2026-01-01T00:00:00Z" } });
  expect(mergeOne(a, b).name).toBe("A");
  expect(mergeOne(b, a).name).toBe("B");
});

test("deletion propagates when __deleted__ clock is newer", () => {
  const live = conn("1", { deleted_at: undefined, clocks: { name: "2026-01-01T00:00:00Z" } });
  const tombstone = conn("1", { deleted_at: "2026-02-01T00:00:00Z", clocks: { __deleted__: "2026-02-01T00:00:00Z" } });
  expect(mergeOne(live, tombstone).deleted_at).toBe("2026-02-01T00:00:00Z");
});

test("revival: a newer live update beats an older tombstone via updated_at", () => {
  const tombstone = conn("1", { deleted_at: "2026-01-01T00:00:00Z", clocks: { __deleted__: "2026-01-01T00:00:00Z" } });
  const revived = conn("1", { name: "back", deleted_at: undefined, clocks: { name: "2026-03-01T00:00:00Z" } });
  const merged = mergeOne(tombstone, revived);
  // deleted_at stays (older __deleted__ clock retained since revival has no newer __deleted__),
  // but updated_at reflects the newest clock so the UI "alive" check (updated_at > deleted_at) revives it.
  expect(merged.updated_at).toBe("2026-03-01T00:00:00Z");
  expect(merged.updated_at > (merged.deleted_at ?? "")).toBe(true);
});

test("updated_at is derived as the max of all merged clocks", () => {
  const a = conn("1", { clocks: { name: "2026-01-01T00:00:00Z", host: "2026-05-01T00:00:00Z" } });
  const b = conn("1", { clocks: { name: "2026-02-01T00:00:00Z" } });
  expect(mergeOne(a, b).updated_at).toBe("2026-05-01T00:00:00Z");
});

test("merge is symmetric on values: swapping args yields the same winning field values", () => {
  const a = conn("1", { name: "A", host: "hostA", clocks: { name: "2026-01-02T00:00:00Z", host: "2026-01-01T00:00:00Z" } });
  const b = conn("1", { name: "B", host: "hostB", clocks: { name: "2026-01-01T00:00:00Z", host: "2026-01-02T00:00:00Z" } });
  const ab = mergeOne(a, b);
  const ba = mergeOne(b, a);
  expect(ab.name).toBe(ba.name); // "A" (newer name clock on a)
  expect(ab.host).toBe(ba.host); // "hostB" (newer host clock on b)
});
