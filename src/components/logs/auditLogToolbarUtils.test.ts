import { test, expect } from "vitest";
import { getAuditTimeRange, applyAuditLogSearch } from "./auditLogToolbarUtils.ts";
import type { AuditLog } from "@/services/auditService";

const NOW = new Date("2026-07-21T12:00:00Z");

test("getAuditTimeRange: last-day is 24h before now, no upper bound", () => {
  expect(getAuditTimeRange("last-day", NOW)).toEqual({
    from: new Date("2026-07-20T12:00:00Z").toISOString(),
    to: undefined,
  });
});

test("getAuditTimeRange: last-week and last-month scale correctly", () => {
  expect(getAuditTimeRange("last-week", NOW).from).toBe(new Date("2026-07-14T12:00:00Z").toISOString());
  expect(getAuditTimeRange("last-month", NOW).from).toBe(new Date("2026-06-21T12:00:00Z").toISOString());
});

test("getAuditTimeRange: all and custom return no bounds", () => {
  expect(getAuditTimeRange("all", NOW)).toEqual({ from: undefined, to: undefined });
  expect(getAuditTimeRange("custom", NOW)).toEqual({ from: undefined, to: undefined });
});

function log(over: Partial<AuditLog>): AuditLog {
  return {
    id: 1, team_id: "t", vault_id: null, actor_id: "actor-1", actor_name: "Alice",
    action: "connection.started", source: "client", target_type: "connection", target_id: "c1",
    target_name: "prod-db", metadata: null, ip_address: null, created_at: "2026-07-20T00:00:00Z", ...over,
  } as AuditLog;
}

test("applyAuditLogSearch: empty/whitespace query returns all", () => {
  const logs = [log({}), log({ actor_name: "Bob" })];
  expect(applyAuditLogSearch(logs, "   ")).toHaveLength(2);
});

test("applyAuditLogSearch: matches across actor, action, target, case-insensitively", () => {
  const logs = [log({ actor_name: "Alice" }), log({ actor_name: "Bob", target_name: "staging" })];
  expect(applyAuditLogSearch(logs, "alice").map((l) => l.actor_name)).toEqual(["Alice"]);
  expect(applyAuditLogSearch(logs, "STAGING").map((l) => l.actor_name)).toEqual(["Bob"]);
  expect(applyAuditLogSearch(logs, "connection.started")).toHaveLength(2);
});

test("applyAuditLogSearch: searches serialized metadata", () => {
  const logs = [log({ metadata: { host: "10.0.0.9" } }), log({ metadata: null })];
  expect(applyAuditLogSearch(logs, "10.0.0.9")).toHaveLength(1);
});
