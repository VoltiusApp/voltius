import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ batches: [] as { object_id: string }[][] }));

vi.mock("@/services/teamObjects", () => ({
  reencryptTeamObjects: vi.fn(async (_teamId: string, items: { object_id: string }[]) => {
    h.batches.push(items);
  }),
}));

vi.mock("@/services/teamObjectEnvelope", () => ({
  isEncryptedEnvelope: (m: unknown) =>
    typeof m === "object" && m !== null &&
    (m as Record<string, unknown>).v === 2 &&
    typeof (m as Record<string, unknown>).enc === "string",
  encodeObjectMetadata: vi.fn(async (_teamId: string, item: object) => ({
    v: 2 as const,
    enc: JSON.stringify(item),
  })),
}));

const h2 = vi.hoisted(() => ({ allowed: new Set<string>() }));

vi.mock("@/services/permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/permissions")>()),
  resolveCan: vi.fn((_snapshot: unknown, permission: string) => h2.allowed.has(permission)),
}));

import { runReencryptionPass, countUnencryptedObjects } from "./teamObjectReencrypt";
import { useTeamVaultStateStore } from "@/stores/teamVaultStateStore";

const legacy = (id: string, type: string) => ({
  object_id: id,
  object_type: type,
  metadata: { id, name: id },
  updated_at: "2026-09-01T00:00:00.000Z",
  updated_by: "u1",
});

beforeEach(() => {
  h.batches = [];
  h2.allowed = new Set(["EDIT_CONNECTIONS", "EDIT_KEYS", "EDIT_IDENTITIES", "EDIT_FOLDERS", "EDIT_SNIPPETS"]);
  useTeamVaultStateStore.getState().clearAll();
});

test("re-encrypts only the rows that are still plaintext", async () => {
  const done = await runReencryptionPass("t1", [
    legacy("c1", "connection"),
    { ...legacy("c2", "connection"), metadata: { v: 2, enc: "already" } },
  ] as never);

  expect(done).toBe(1);
  expect(h.batches.flat().map((i) => i.object_id)).toEqual(["c1"]);
});

test("skips object types the caller cannot edit", async () => {
  h2.allowed = new Set(["EDIT_CONNECTIONS"]);

  const done = await runReencryptionPass("t1", [
    legacy("c1", "connection"),
    legacy("k1", "key"),
    legacy("i1", "identity"),
  ] as never);

  expect(done).toBe(1);
  expect(h.batches.flat().map((i) => i.object_id)).toEqual(["c1"]);
});

test("sends nothing when every row is already encrypted", async () => {
  const done = await runReencryptionPass("t1", [
    { ...legacy("c1", "connection"), metadata: { v: 2, enc: "already" } },
  ] as never);

  expect(done).toBe(0);
  expect(h.batches).toEqual([]);
});

test("counts rows still in plaintext regardless of permission", () => {
  expect(
    countUnencryptedObjects([
      legacy("c1", "connection"),
      legacy("k1", "key"),
      { ...legacy("c2", "connection"), metadata: { v: 2, enc: "x" } },
    ] as never),
  ).toBe(2);
});

test("records the remaining unencrypted count on useTeamVaultStateStore, keyed by team", async () => {
  // Only "key" rows are editable by this member, so the "connection" row stays
  // plaintext after the pass and must still be reflected in the remaining count.
  h2.allowed = new Set(["EDIT_KEYS"]);

  await runReencryptionPass("t2", [
    legacy("c1", "connection"),
    legacy("k1", "key"),
  ] as never);

  expect(useTeamVaultStateStore.getState().unencryptedCountByTeamId.t2).toBe(1);

  // A second pass where every remaining row is now editable clears the count to zero.
  h2.allowed = new Set(["EDIT_CONNECTIONS", "EDIT_KEYS"]);
  await runReencryptionPass("t2", [
    legacy("c1", "connection"),
    { ...legacy("k1", "key"), metadata: { v: 2, enc: "already" } },
  ] as never);

  expect(useTeamVaultStateStore.getState().unencryptedCountByTeamId.t2).toBe(0);
});
