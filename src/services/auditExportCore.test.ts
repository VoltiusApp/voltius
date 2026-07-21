import { test, expect } from "vitest";
import { applyAuditFilters, csvEscape } from "./auditExportCore.ts";

interface Row { action: string; actor_id: string; created_at: string; }
const rows: Row[] = [
  { action: "connection.started", actor_id: "u1", created_at: "2026-07-10T00:00:00Z" },
  { action: "secret.viewed", actor_id: "u2", created_at: "2026-07-15T00:00:00Z" },
  { action: "connection.ended", actor_id: "u1", created_at: "2026-07-20T00:00:00Z" },
];

test("no filters returns all rows", () => {
  expect(applyAuditFilters(rows, {})).toHaveLength(3);
});

test("actions filter keeps only matching actions", () => {
  const out = applyAuditFilters(rows, { actions: ["secret.viewed"] });
  expect(out.map((r) => r.actor_id)).toEqual(["u2"]);
});

test("empty actions array is treated as no action filter", () => {
  expect(applyAuditFilters(rows, { actions: [] })).toHaveLength(3);
});

test("actor_id filter is exact match", () => {
  expect(applyAuditFilters(rows, { actor_id: "u1" }).map((r) => r.created_at))
    .toEqual(["2026-07-10T00:00:00Z", "2026-07-20T00:00:00Z"]);
});

test("date range keeps both boundaries; only created < from or created > to are excluded", () => {
  const out = applyAuditFilters(rows, { from: "2026-07-15T00:00:00Z", to: "2026-07-20T00:00:00Z" });
  // from boundary kept (created < from excluded), to boundary kept (created > to excluded); the 07-20 row equals `to` and stays
  expect(out.map((r) => r.created_at)).toEqual(["2026-07-15T00:00:00Z", "2026-07-20T00:00:00Z"]);
});

test("unparseable from/to bounds are ignored (row passes through)", () => {
  expect(applyAuditFilters(rows, { from: "not-a-date" })).toHaveLength(3);
});

test("csvEscape quotes values containing comma, quote, or newline; doubles quotes", () => {
  expect(csvEscape("plain")).toBe("plain");
  expect(csvEscape("a,b")).toBe('"a,b"');
  expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
  expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  expect(csvEscape(null)).toBe("");
  expect(csvEscape(42)).toBe("42");
});

test("csvEscape neutralizes formula-injection triggers", () => {
  expect(csvEscape("=cmd()")).toBe("'=cmd()");
  expect(csvEscape("+1")).toBe("'+1");
  expect(csvEscape("-1")).toBe("'-1");
  expect(csvEscape("@x")).toBe("'@x");
  // combined with a comma still gets quoted around the neutralized value
  expect(csvEscape("=a,b")).toBe(`"'=a,b"`);
});
