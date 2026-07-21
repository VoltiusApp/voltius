import { describe, it, expect } from "vitest";
import { mergeSecrets, secretsDiffer } from "./crdt";

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
