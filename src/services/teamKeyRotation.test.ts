import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  status: { stale: false, draining: false } as { stale: boolean; draining: boolean },
  rotateCalls: [] as { user_id: string; wrapped_key: string }[][],
  members: [] as { user_id: string; public_key: string }[],
  allowed: new Set<string>(),
  objects: [] as { object_id: string; object_type: string; metadata: unknown }[],
  secrets: [] as { secret_id: string; object_id: string; ciphertext: string; key_version: number }[],
  reencryptObjectCalls: [] as unknown[],
  reencryptSecretCalls: [] as unknown[],
}));

vi.mock("@/services/teamService", () => ({
  getRotationStatus: vi.fn(async () => h.status),
  rotateVaultKey: vi.fn(async (_teamId: string, keys: unknown) => { h.rotateCalls.push(keys as never); }),
  listMembers: vi.fn(async () => h.members),
  getMyUserId: vi.fn(async () => "me"),
}));
vi.mock("@/services/multiplayerService", () => ({
  wrapSessionKeyForUser: vi.fn(async (_bytes: Uint8Array, pk: string) => `wrapped-for-${pk}`),
}));
vi.mock("@/services/teamVaultSync", () => ({
  getTeamVaultKey: vi.fn(async () => [1, 2, 3]),
  getCachedTeamKeyVersion: vi.fn(() => 1),
}));
vi.mock("@/services/teamObjects", () => ({
  listTeamObjects: vi.fn(async () => h.objects),
  reencryptTeamObjects: vi.fn(async (_teamId: string, items: unknown) => { h.reencryptObjectCalls.push(items); }),
  listTeamSecrets: vi.fn(async () => h.secrets),
  reencryptTeamSecrets: vi.fn(async (_teamId: string, items: unknown) => { h.reencryptSecretCalls.push(items); }),
}));
vi.mock("@/services/teamObjectEnvelope", () => ({
  isEncryptedEnvelope: (m: unknown) =>
    typeof m === "object" && m !== null && (m as Record<string, unknown>).v === 2,
  encodeObjectMetadata: vi.fn(async (_teamId: string, _item: object) => ({ v: 2, enc: "reenc", kv: 1 })),
}));
vi.mock("@/services/teamObjectEditPermission", () => ({
  buildEditPermissionSnapshot: vi.fn(async () => ({})),
  // Uses the real `objectType` argument (not just a fixed "connection" check)
  // so the "draining" test below can actually distinguish an editable type
  // ("connection") from one the caller cannot edit ("key").
  canEditObjectType: vi.fn((_snapshot: unknown, _teamId: string, objectType: string) => h.allowed.has(objectType)),
}));

import { checkAndRotateTeamKey } from "./teamKeyRotation";

beforeEach(() => {
  h.status = { stale: false, draining: false };
  h.rotateCalls = [];
  h.members = [];
  h.allowed = new Set(["connection"]);
  h.objects = [];
  h.secrets = [];
  h.reencryptObjectCalls = [];
  h.reencryptSecretCalls = [];
});

test("neither stale nor draining: does nothing", async () => {
  await checkAndRotateTeamKey("t1");
  expect(h.rotateCalls).toHaveLength(0);
  expect(h.reencryptObjectCalls).toHaveLength(0);
});

test("stale and not draining: rotates, wrapping for every member with a public key", async () => {
  h.status = { stale: true, draining: false };
  h.members = [
    { user_id: "me", public_key: "me-pk" },
    { user_id: "other", public_key: "other-pk" },
    { user_id: "keyless", public_key: "" },
  ];

  await checkAndRotateTeamKey("t1");

  expect(h.rotateCalls).toHaveLength(1);
  const sent = h.rotateCalls[0].map((k) => k.user_id).sort();
  expect(sent).toEqual(["me", "other"]);
});

test("draining: does not rotate again, and re-encrypts only editable object types", async () => {
  h.status = { stale: false, draining: true };
  h.objects = [
    { object_id: "c1", object_type: "connection", metadata: { v: 2, enc: "old", kv: 0 } },
    { object_id: "k1", object_type: "key", metadata: { v: 2, enc: "old", kv: 0 } },
  ];

  await checkAndRotateTeamKey("t1");

  expect(h.rotateCalls).toHaveLength(0);
  expect(h.reencryptObjectCalls.flat().map((i: unknown) => (i as { object_id: string }).object_id)).toEqual(["c1"]);
});

test("stale and draining: drains, does not also rotate (serialization rule)", async () => {
  h.status = { stale: true, draining: true };
  await checkAndRotateTeamKey("t1");
  expect(h.rotateCalls).toHaveLength(0);
});

test("concurrent calls for the same team dedup to one pass", async () => {
  h.status = { stale: true, draining: false };
  h.members = [{ user_id: "me", public_key: "me-pk" }];

  await Promise.all([checkAndRotateTeamKey("t1"), checkAndRotateTeamKey("t1")]);

  expect(h.rotateCalls).toHaveLength(1);
});
