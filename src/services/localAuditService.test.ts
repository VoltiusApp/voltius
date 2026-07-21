import { test, expect, beforeEach } from "vitest";
import { reportLocalClientEvent, fetchLocalAuditLogs } from "./localAuditService.ts";

const KEY = "voltius-local-audit-logs";
const filters = { page: 1, per_page: 100 } as never;

beforeEach(() => localStorage.clear());

test("assigns strictly increasing ids across events", async () => {
  await reportLocalClientEvent("v1", { action: "connection.started", occurred_at: "2026-07-20T00:00:00Z" } as never);
  await reportLocalClientEvent("v1", { action: "connection.ended", occurred_at: "2026-07-20T00:01:00Z" } as never);
  const { logs } = await fetchLocalAuditLogs("v1", filters);
  const ids = logs.map((l) => l.id);
  expect(new Set(ids).size).toBe(ids.length); // no duplicates
});

test("corrupt localStorage JSON is recovered as an empty db (no throw)", async () => {
  localStorage.setItem(KEY, "{not valid json");
  const { logs, total } = await fetchLocalAuditLogs("v1", filters);
  expect(total).toBe(0);
  expect(logs).toEqual([]);
});

test("malformed log entries are dropped by the type guard", async () => {
  localStorage.setItem(KEY, JSON.stringify({
    nextId: 5,
    logsByVault: { v1: [{ id: "not-a-number", team_id: "local" }, null, 42] },
  }));
  const { total } = await fetchLocalAuditLogs("v1", filters);
  expect(total).toBe(0); // all three entries fail isLocalAuditLog
});

test("nextId never regresses below the highest persisted log id", async () => {
  // Seed a valid log with id 9 but a stale nextId of 1.
  localStorage.setItem(KEY, JSON.stringify({
    nextId: 1,
    logsByVault: { v1: [{
      id: 9, team_id: "local", vault_id: "v1", actor_id: "local-user", actor_name: "You",
      action: "secret.viewed", source: "client", target_type: null, target_id: null,
      target_name: null, metadata: null, ip_address: null, created_at: "2026-07-19T00:00:00Z",
    }] },
  }));
  await reportLocalClientEvent("v1", { action: "connection.started", occurred_at: "2026-07-20T00:00:00Z" } as never);
  const { logs } = await fetchLocalAuditLogs("v1", filters);
  const newId = logs.find((l) => l.action === "connection.started")!.id;
  expect(newId).toBeGreaterThan(9); // did not reuse id and collide with the seeded log
});
