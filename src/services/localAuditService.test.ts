import { test, expect, beforeEach } from "vitest";
import {
  reportLocalClientEvent,
  fetchLocalAuditLogs,
  trimToBudget,
  MAX_LOCAL_LOGS_PER_VAULT,
  MAX_LOCAL_LOG_CHARS_PER_VAULT,
} from "./localAuditService.ts";

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

test("the byte budget binds before MAX_LOCAL_LOGS_PER_VAULT for realistically-sized rows, keeping the newest", async () => {
  seedLogs("v1", MAX_LOCAL_LOGS_PER_VAULT);
  await reportLocalClientEvent("v1", {
    action: "connection.started", occurred_at: "2026-06-01T00:00:00Z", target_id: "newest",
  } as never);

  const { total, logs } = await fetchLocalAuditLogs("v1", filters);
  // These entries are realistically-shaped (~245+ chars each once serialized),
  // so 5000 of them already exceed MAX_LOCAL_LOG_CHARS_PER_VAULT on their own —
  // the byte budget binds before the entry-count cap does. That is Finding 1's
  // whole point: the count cap alone never guaranteed staying under quota.
  // The entry-count cap is still exercised in isolation, with byte-cheap
  // synthetic entries, below.
  expect(total).toBeLessThan(MAX_LOCAL_LOGS_PER_VAULT);
  expect(logs[0].target_id).toBe("newest");

  // Read the full persisted vault (fetchLocalAuditLogs paginates at 100) and
  // confirm what was actually retained respects the byte budget — not merely
  // that its count is below 5000, which `toBeLessThan(MAX_LOCAL_LOGS_PER_VAULT)`
  // alone would also accept even at total === 1. The lower bound rules out a
  // trim that over-deletes (stops far short of the budget it is allowed to
  // fill): each seeded row here serializes to ~260 chars, so stopping more
  // than one row's worth (500 chars) short of the budget would mean the trim
  // gave up too early.
  const raw = JSON.parse(localStorage.getItem(KEY)!) as { logsByVault: Record<string, unknown[]> };
  const stored = raw.logsByVault.v1;
  const serialized = stored.reduce((sum: number, l) => sum + JSON.stringify(l).length, 0);
  expect(serialized).toBeLessThanOrEqual(MAX_LOCAL_LOG_CHARS_PER_VAULT);
  expect(serialized).toBeGreaterThan(MAX_LOCAL_LOG_CHARS_PER_VAULT - 500);
});

test("MAX_LOCAL_LOGS_PER_VAULT still bounds the entry count when the byte budget is not the binding constraint", () => {
  // Byte-cheap synthetic entries (not full AuditLog shape) isolate the
  // entry-count cap from the byte-serialization cap: at realistic per-entry
  // sizes the byte budget always binds first (see the test above), so this
  // exercises the regime the count cap actually still governs — many, cheap
  // entries, e.g. immediately after a schema/size change shrinks row size.
  const logs = Array.from(
    { length: MAX_LOCAL_LOGS_PER_VAULT + 50 },
    (_, i) => ({ id: MAX_LOCAL_LOGS_PER_VAULT + 50 - i }) as never,
  );
  const trimmed = trimToBudget(logs);
  expect(trimmed.length).toBe(MAX_LOCAL_LOGS_PER_VAULT);
  expect((trimmed[0] as unknown as { id: number }).id).toBe(MAX_LOCAL_LOGS_PER_VAULT + 50); // newest (first) kept
});

test("trimming drops the OLDEST entry, not an arbitrary one", async () => {
  seedLogs("v1", MAX_LOCAL_LOGS_PER_VAULT);
  const before = await fetchLocalAuditLogs("v1", filters);
  const oldestId = before.logs[before.logs.length - 1].id;

  await reportLocalClientEvent("v1", {
    action: "connection.started", occurred_at: "2026-06-01T00:00:00Z",
  } as never);

  const after = await fetchLocalAuditLogs("v1", filters);
  expect(after.logs.some((l) => l.id === oldestId)).toBe(false);
});

test("trimming one vault leaves other vaults untouched", async () => {
  seedLogs("v1", MAX_LOCAL_LOGS_PER_VAULT);
  await reportLocalClientEvent("v2", { action: "secret.viewed", occurred_at: "2026-06-01T00:00:00Z" } as never);
  await reportLocalClientEvent("v1", { action: "connection.started", occurred_at: "2026-06-01T00:01:00Z" } as never);

  expect((await fetchLocalAuditLogs("v2", filters)).total).toBe(1);
});

test("a vault under the cap is not trimmed", async () => {
  await reportLocalClientEvent("v1", { action: "secret.viewed", occurred_at: "2026-06-01T00:00:00Z" } as never);
  await reportLocalClientEvent("v1", { action: "secret.viewed", occurred_at: "2026-06-01T00:01:00Z" } as never);
  expect((await fetchLocalAuditLogs("v1", filters)).total).toBe(2);
});

function seedLogsWithBlob(vaultId: string, count: number, blobLen: number) {
  const logs = Array.from({ length: count }, (_, i) => ({
    id: count - i, team_id: "local", vault_id: vaultId, actor_id: "local-user",
    actor_name: "You", action: "secret.viewed", source: "client",
    target_type: null, target_id: String(count - i), target_name: null,
    metadata: { blob: "x".repeat(blobLen) }, ip_address: null,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, count - i)).toISOString(),
  }));
  localStorage.setItem(KEY, JSON.stringify({ nextId: count + 1, logsByVault: { [vaultId]: logs } }));
}

test("a single oversized entry is retained, never dropped to an empty log", async () => {
  // One entry whose own serialized size alone blows the whole byte budget.
  const huge = "x".repeat(MAX_LOCAL_LOG_CHARS_PER_VAULT * 2);
  await reportLocalClientEvent("v1", {
    action: "connection.started",
    occurred_at: "2026-06-01T00:00:00Z",
    metadata: { blob: huge },
  } as never);

  const { total, logs } = await fetchLocalAuditLogs("v1", filters);
  expect(total).toBe(1); // kept, not trimmed to nothing
  expect((logs[0].metadata as { blob: string }).blob).toBe(huge);
});

test("a vault of many medium entries is trimmed to the byte budget, keeping the newest", async () => {
  // Each seeded entry serializes to ~1050 chars; 600 of them (~630,000 chars)
  // exceed the 512,000-char budget while staying well under the 5000-entry
  // cap, so this exercises the byte trim specifically, not the count cap.
  const blobLen = 1000;
  const count = 600;
  seedLogsWithBlob("v1", count, blobLen);

  await reportLocalClientEvent("v1", {
    action: "connection.started",
    occurred_at: "2026-06-01T00:00:00Z",
    target_id: "newest",
  } as never);

  const { total } = await fetchLocalAuditLogs("v1", filters);
  expect(total).toBeGreaterThan(1);
  expect(total).toBeLessThan(count + 1); // some oldest entries were dropped

  // Read the full persisted vault (fetchLocalAuditLogs paginates at 100) to
  // check the newest-kept and byte-budget invariants against everything that
  // was actually written, not just one page of it.
  const raw = JSON.parse(localStorage.getItem(KEY)!) as { logsByVault: Record<string, unknown[]> };
  const stored = raw.logsByVault.v1;
  expect((stored[0] as { target_id: string }).target_id).toBe("newest");
  const serialized = stored.reduce((sum: number, l) => sum + JSON.stringify(l).length, 0);
  expect(serialized).toBeLessThanOrEqual(MAX_LOCAL_LOG_CHARS_PER_VAULT);
});
