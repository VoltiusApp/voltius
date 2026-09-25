import { describe, it, expect } from "vitest";
import { entitiesDiffer, mergeEntities, mergeSecrets, secretsDiffer, type TimestampedEntity } from "./crdt";

const T1 = "2026-07-20T09:00:00Z";
const T2 = "2026-07-21T12:00:00Z";

describe("mergeSecrets — timestamped LWW (issue #35)", () => {
  it("keeps the locally-changed password when local's timestamp is newer", () => {
    const r = mergeSecrets(
      { "password:c1": "NEW" }, { "password:c1": T2 },
      { "password:c1": "OLD" }, { "password:c1": T1 },
    );
    expect(r.secrets["password:c1"]).toBe("NEW");
    expect(r.clocks["password:c1"]).toBe(T2);
  });

  it("takes the remote password when remote's timestamp is newer (reverse direction)", () => {
    const r = mergeSecrets(
      { "password:c1": "OLD" }, { "password:c1": T1 },
      { "password:c1": "NEW" }, { "password:c1": T2 },
    );
    expect(r.secrets["password:c1"]).toBe("NEW");
    expect(r.clocks["password:c1"]).toBe(T2);
  });

  it("local genuine edit (timestamped) beats a legacy remote value with no timestamp", () => {
    const r = mergeSecrets(
      { "password:c1": "NEW" }, { "password:c1": T2 },
      { "password:c1": "OLD" }, {}, // legacy remote: no clock
    );
    expect(r.secrets["password:c1"]).toBe("NEW");
  });

  it("propagates a deletion: newer tombstone (local) removes the value", () => {
    // Local deleted the secret at T2 (tombstone: clock present, value absent).
    const r = mergeSecrets(
      {}, { "password:c1": T2 },
      { "password:c1": "OLD" }, { "password:c1": T1 },
    );
    expect("password:c1" in r.secrets).toBe(false);
    expect(r.clocks["password:c1"]).toBe(T2); // tombstone retained so it keeps propagating
  });

  it("propagates a deletion in the reverse direction (remote tombstone newer)", () => {
    const r = mergeSecrets(
      { "password:c1": "OLD" }, { "password:c1": T1 },
      {}, { "password:c1": T2 },
    );
    expect("password:c1" in r.secrets).toBe(false);
    expect(r.clocks["password:c1"]).toBe(T2);
  });

  it("a newer live value wins over an older tombstone (re-created secret)", () => {
    const r = mergeSecrets(
      { "password:c1": "REBORN" }, { "password:c1": T2 },
      {}, { "password:c1": T1 }, // remote tombstone, older
    );
    expect(r.secrets["password:c1"]).toBe("REBORN");
    expect(r.clocks["password:c1"]).toBe(T2);
  });

  it("keeps a secret that exists only on one side", () => {
    const r = mergeSecrets(
      { "password:a": "L" }, { "password:a": T1 },
      { "password:b": "R" }, { "password:b": T2 },
    );
    expect(r.secrets["password:a"]).toBe("L");
    expect(r.secrets["password:b"]).toBe("R");
  });

  it("both legacy (no clocks), both present with differing values → deterministic, side-independent", () => {
    const forward = mergeSecrets({ k: "aaa" }, {}, { k: "bbb" }, {});
    const reverse = mergeSecrets({ k: "bbb" }, {}, { k: "aaa" }, {});
    // Symmetric tie-break (lexical max) — both devices converge on the same value.
    expect(forward.secrets.k).toBe("bbb");
    expect(reverse.secrets.k).toBe("bbb");
  });

  it("equal timestamps, one present one tombstone → present wins (symmetric)", () => {
    const forward = mergeSecrets({ k: "v" }, { k: T2 }, {}, { k: T2 });
    const reverse = mergeSecrets({}, { k: T2 }, { k: "v" }, { k: T2 });
    expect(forward.secrets.k).toBe("v");
    expect(reverse.secrets.k).toBe("v");
  });
});

describe("secretsDiffer", () => {
  it("detects value changes", () => {
    expect(secretsDiffer({ a: "1" }, { a: "2" })).toBe(true);
  });
  it("detects additions and removals", () => {
    expect(secretsDiffer({ a: "1" }, { a: "1", b: "2" })).toBe(true);
    expect(secretsDiffer({ a: "1", b: "2" }, { a: "1" })).toBe(true);
  });
  it("returns false for identical maps", () => {
    expect(secretsDiffer({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(false);
  });
});

describe("entitiesDiffer", () => {
  // B renamed at 10:00; A then touched last_used_at at 10:01.
  type Host = TimestampedEntity & { name: string; last_used_at: string | null };
  const onA: Host = {
    id: "c1", name: "orig", last_used_at: "2026-07-20T10:01:00Z", updated_at: "2026-07-20T10:01:00Z",
    clocks: { name: "2026-07-20T09:00:00Z", last_used_at: "2026-07-20T10:01:00Z" },
  };
  const onB: Host = {
    id: "c1", name: "renamed", last_used_at: null, updated_at: "2026-07-20T10:00:00Z",
    clocks: { name: "2026-07-20T10:00:00Z" },
  };

  it("sees a remote field that wins while older than the newest local clock", () => {
    const merged = mergeEntities([onA], [onB]);
    expect(merged[0].name).toBe("renamed");
    expect(merged[0].updated_at).toBe(onA.updated_at);
    expect(entitiesDiffer([onA], merged)).toBe(true);
  });

  it("is false when the merge kept everything local", () => {
    expect(entitiesDiffer([onA], mergeEntities([onA], [onA]))).toBe(false);
  });

  it("sees an entity that arrived from the remote side", () => {
    expect(entitiesDiffer([], mergeEntities([], [onB]))).toBe(true);
  });
});
