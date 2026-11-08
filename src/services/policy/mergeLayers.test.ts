import { describe, it, expect } from "vitest";
import { combineEntry, intersectRanges, mergeTeamDocs, mergeMachineAndTeam } from "./mergeLayers";

const r = (x: object) => ({ $range: x });

describe("combineEntry", () => {
  const cases: [string, unknown, unknown, unknown, string, boolean][] = [
    ["lock vs differing lock", false, true, false, "earlier", true],
    ["equal locks", false, false, false, "earlier", false],
    ["range then fixed in range", r({ max: 15 }), 5, 5, "later", false],
    ["range then fixed outside", r({ max: 15 }), 30, r({ max: 15 }), "earlier", true],
    ["fixed then range", 5, r({ max: 15 }), 5, "earlier", false],
    ["ranges intersect", r({ max: 30 }), r({ max: 15, min: 5 }), r({ min: 5, max: 15 }), "both", false],
    ["empty intersection", r({ min: 30 }), r({ max: 15 }), r({ min: 30 }), "earlier", true],
    ["allowed intersect", r({ allowed: ["a", "b"] }), r({ allowed: ["b", "c"] }), r({ allowed: ["b"] }), "both", false],
    ["undefined earlier", undefined, "x", "x", "later", false],
  ];
  it.each(cases)("%s", (_n, e, l, value, from, conflict) => {
    expect(combineEntry(e, l)).toEqual({ value, from, conflict });
  });
  it("intersectRanges null when empty allowed", () => {
    expect(intersectRanges({ allowed: ["a"] }, { allowed: ["b"] })).toBeNull();
  });
});

describe("mergeTeamDocs", () => {
  const a = { teamId: "a", teamName: "Alpha", joinedAt: "2026-01-01", policy: { k: false } };
  const b = { teamId: "b", teamName: "Beta", joinedAt: "2026-02-01", policy: { k: true } };
  it("earliest joined wins regardless of order", () => {
    const m = mergeTeamDocs([b, a]);
    expect(m.policy.k).toBe(false);
    expect(m.teams.k).toEqual(["Alpha"]);
  });
  it("names both teams and key on conflict", () => {
    const [i] = mergeTeamDocs([b, a]).issues;
    expect(i.kind).toBe("conflict");
    expect(i.layer).toBe("policy");
    expect(i.key).toBe("k");
    expect(i.message).toContain("Alpha");
    expect(i.message).toContain("Beta");
    expect(i.message).toContain("k");
  });
  it("intersects ranges and lists both teams", () => {
    const m = mergeTeamDocs([
      { ...a, policy: { n: r({ max: 30 }) } },
      { ...b, policy: { n: r({ min: 5 }) } },
    ]);
    expect(m.policy.n).toEqual(r({ min: 5, max: 30 }));
    expect(m.teams.n).toEqual(["Alpha", "Beta"]);
    expect(m.issues).toEqual([]);
  });
});

describe("mergeMachineAndTeam", () => {
  const team = (policy: Record<string, unknown>) => mergeTeamDocs([{ teamId: "a", teamName: "Alpha", joinedAt: "1", policy }]);
  it("machine lock beats team", () => {
    const m = mergeMachineAndTeam({ k: false }, team({ k: true }));
    expect(m.policy.k).toBe(false);
    expect(m.sources.k.source).toBe("machine");
    expect(m.issues.filter((i) => i.kind === "conflict")).toHaveLength(1);
    expect(m.issues[0].message).toContain("machine policy");
  });
  it("machine range tighter than team", () => {
    const m = mergeMachineAndTeam({ n: r({ max: 5 }) }, team({ n: r({ max: 30 }) }));
    expect(m.policy.n).toEqual(r({ max: 5 }));
  });
  it("team-only key is server sourced", () => {
    const m = mergeMachineAndTeam({}, team({ k: true }));
    expect(m.policy.k).toBe(true);
    expect(m.sources.k).toEqual({ source: "server", teams: ["Alpha"] });
  });
});
