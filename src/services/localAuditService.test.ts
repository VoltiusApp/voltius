import { test, expect, beforeEach } from "vitest";
import { reportLocalClientEvent, fetchLocalAuditLogs, MAX_LOCAL_LOGS_PER_VAULT } from "./localAuditService.ts";

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

function seedLogs(vaultId: string, count: number) {
  // Seeded directly rather than via 5000 reportLocalClientEvent calls: each
  // call re-serializes the whole db, so the loop would be O(n^2) on JSON.
  const logs = Array.from({ length: count }, (_, i) => ({
    id: count - i, team_id: "local", vault_id: vaultId, actor_id: "local-user",
    actor_name: "You", action: "secret.viewed", source: "client",
    target_type: null, target_id: String(count - i), target_name: null,
    metadata: null, ip_address: null,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, count - i)).toISOString(),
  }));
  localStorage.setItem(KEY, JSON.stringify({ nextId: count + 1, logsByVault: { [vaultId]: logs } }));
}

test("caps a vault at MAX_LOCAL_LOGS_PER_VAULT, keeping the newest", async () => {
  seedLogs("v1", MAX_LOCAL_LOGS_PER_VAULT);
  await reportLocalClientEvent("v1", {
    action: "agent.command_run", occurred_at: "2026-06-01T00:00:00Z", target_id: "newest",
  } as never);

  const { total, logs } = await fetchLocalAuditLogs("v1", filters);
  expect(total).toBe(MAX_LOCAL_LOGS_PER_VAULT);
  expect(logs[0].target_id).toBe("newest");
});

test("trimming drops the OLDEST entry, not an arbitrary one", async () => {
  seedLogs("v1", MAX_LOCAL_LOGS_PER_VAULT);
  const before = await fetchLocalAuditLogs("v1", filters);
  const oldestId = before.logs[before.logs.length - 1].id;

  await reportLocalClientEvent("v1", {
    action: "agent.command_run", occurred_at: "2026-06-01T00:00:00Z",
  } as never);

  const after = await fetchLocalAuditLogs("v1", filters);
  expect(after.logs.some((l) => l.id === oldestId)).toBe(false);
});

test("trimming one vault leaves other vaults untouched", async () => {
  seedLogs("v1", MAX_LOCAL_LOGS_PER_VAULT);
  await reportLocalClientEvent("v2", { action: "secret.viewed", occurred_at: "2026-06-01T00:00:00Z" } as never);
  await reportLocalClientEvent("v1", { action: "agent.command_run", occurred_at: "2026-06-01T00:01:00Z" } as never);

  expect((await fetchLocalAuditLogs("v2", filters)).total).toBe(1);
});

test("a vault under the cap is not trimmed", async () => {
  await reportLocalClientEvent("v1", { action: "secret.viewed", occurred_at: "2026-06-01T00:00:00Z" } as never);
  await reportLocalClientEvent("v1", { action: "secret.viewed", occurred_at: "2026-06-01T00:01:00Z" } as never);
  expect((await fetchLocalAuditLogs("v1", filters)).total).toBe(2);
});
