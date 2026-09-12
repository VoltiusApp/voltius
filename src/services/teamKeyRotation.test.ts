import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  status: { stale: false, draining: false } as { stale: boolean; draining: boolean },
  rotateCalls: [] as { user_id: string; wrapped_key: string }[][],
  members: [] as { user_id: string; public_key: string }[],
  allowed: new Set<string>(),
  objects: [] as { object_id: string; object_type: string; metadata: unknown; deleted_at?: string }[],
  secrets: [] as { secret_id: string; object_id: string; ciphertext: string; key_version: number }[],
  reencryptObjectCalls: [] as unknown[],
  reencryptSecretCalls: [] as unknown[],
  getTeamVaultKeyAtVersionCalls: [] as unknown[][],
  deleteTeamKeyCalls: [] as string[],
  reencryptLegacyBlobCalls: [] as unknown[][],
}));

vi.mock("@/services/teamService", () => ({
  getRotationStatus: vi.fn(async () => h.status),
  rotateVaultKey: vi.fn(async (_teamId: string, keys: unknown) => { h.rotateCalls.push(keys as never); }),
  listMembers: vi.fn(async () => h.members),
  getMyUserId: vi.fn(async () => "me"),
}));
vi.mock("@/services/multiplayerService", () => ({
  wrapSessionKeyForUser: vi.fn(async (_bytes: Uint8Array, pk: string) => `wrapped-for-${pk}`),
  publishMyPublicKey: vi.fn(async () => "me-published-pk"),
}));
vi.mock("@/services/teamVaultSync", () => ({
  getTeamVaultKey: vi.fn(async () => [1, 2, 3]),
  getCachedTeamKeyVersion: vi.fn(() => 1),
  getTeamVaultKeyAtVersion: vi.fn(async (teamId: string, version: number) => {
    h.getTeamVaultKeyAtVersionCalls.push([teamId, version]);
    return [7, 7, 7];
  }),
  deleteTeamKey: vi.fn((teamId: string) => { h.deleteTeamKeyCalls.push(teamId); }),
  reencryptLegacyBlobIfStale: vi.fn(async (...args: unknown[]) => { h.reencryptLegacyBlobCalls.push(args); }),
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
  decodeObjectMetadata: vi.fn(async (_teamId: string, metadata: unknown) => metadata),
}));
vi.mock("@/services/teamObjectEditPermission", () => ({
  buildEditPermissionSnapshot: vi.fn(async () => ({})),
  // Uses the real `objectType` argument (not just a fixed "connection" check)
  // so the "draining" test below can actually distinguish an editable type
  // ("connection") from one the caller cannot edit ("key").
  canEditObjectType: vi.fn((_snapshot: unknown, _teamId: string, objectType: string) => h.allowed.has(objectType)),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, _args: Record<string, unknown>) => {
    if (cmd === "backup_decrypt") return { secrets: { "password:c1": "hunter2" } };
    if (cmd === "encrypt_payload") return [9, 9, 9];
    throw new Error(`unexpected invoke ${cmd}`);
  }),
}));
vi.mock("@/services/teamVaultSyncCore", () => ({
  bytesToBase64: (b: number[]) => `b64(${b.join(",")})`,
  base64ToBytes: (_s: string) => [1, 2, 3],
}));

import { checkAndRotateTeamKey } from "./teamKeyRotation";
import { getTeamVaultKeyAtVersion, getCachedTeamKeyVersion } from "@/services/teamVaultSync";

beforeEach(() => {
  h.status = { stale: false, draining: false };
  h.rotateCalls = [];
  h.members = [];
  h.allowed = new Set(["connection"]);
  h.objects = [];
  h.secrets = [];
  h.reencryptObjectCalls = [];
  h.reencryptSecretCalls = [];
  h.getTeamVaultKeyAtVersionCalls = [];
  h.deleteTeamKeyCalls = [];
  h.reencryptLegacyBlobCalls = [];
});

test("neither stale nor draining: does nothing", async () => {
  await checkAndRotateTeamKey("t1");
  expect(h.rotateCalls).toHaveLength(0);
  expect(h.reencryptObjectCalls).toHaveLength(0);
});

// force bypasses rotation-status — it can't see a key_mismatch, since it
// only tracks epoch coverage, not whether a wrap actually decrypts.
test("force: true rotates even when rotation-status says neither stale nor draining", async () => {
  h.status = { stale: false, draining: false };
  h.members = [{ user_id: "me", public_key: "me-pk" }];

  await checkAndRotateTeamKey("t1", { force: true });

  expect(h.rotateCalls).toHaveLength(1);
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

  // Self must be wrapped against the freshly-published public key
  // (mocked to "me-published-pk"), not listMembers' own cached "me-pk" for
  // the calling user — a stale cached key here caused #66/#228 (I-B).
  const selfEntry = h.rotateCalls[0].find((k) => k.user_id === "me");
  expect(selfEntry?.wrapped_key).toBe("wrapped-for-me-published-pk");
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

test("draining: re-encrypts a stale secret by decrypting with its OLD key version and re-wrapping under current", async () => {
  h.status = { stale: false, draining: true };
  h.objects = [
    { object_id: "c1", object_type: "connection", metadata: { v: 2, enc: "old", kv: 0 } },
  ];
  h.secrets = [
    { secret_id: "s1", object_id: "c1", ciphertext: "b64(old-cipher)", key_version: 0 },
  ];

  await checkAndRotateTeamKey("t1");

  // Decrypted using the secret's own (stale) key_version, never the new one.
  expect(getTeamVaultKeyAtVersion).toHaveBeenCalledWith("t1", 0);

  // Re-wrapped under the current epoch (mocked getCachedTeamKeyVersion === 1),
  // with ciphertext reflecting the fresh encrypt_payload call ([9,9,9]).
  expect(h.reencryptSecretCalls.flat()).toEqual([
    { secret_id: "s1", ciphertext: "b64(9,9,9)", key_version: 1 },
  ]);
});

test("draining: reencrypts the legacy blob if stale, using the resolved current key/version (C-B)", async () => {
  h.status = { stale: false, draining: true };

  await checkAndRotateTeamKey("t1");

  expect(h.reencryptLegacyBlobCalls).toEqual([["t1", 1, [1, 2, 3]]]);
});

test("draining: does not touch a secret already at or ahead of the current version", async () => {
  h.status = { stale: false, draining: true };
  h.objects = [
    { object_id: "c1", object_type: "connection", metadata: { v: 2, enc: "old", kv: 1 } },
  ];
  h.secrets = [
    { secret_id: "s1", object_id: "c1", ciphertext: "b64(current-cipher)", key_version: 1 },
  ];

  await checkAndRotateTeamKey("t1");

  expect(h.reencryptSecretCalls).toHaveLength(0);
});

test("draining: a legacy secret with no key_version fetches epoch 1, not vault-key/undefined", async () => {
  // The team has already rotated once (current epoch 2), so an undefined
  // key_version (epoch 1) is genuinely stale and must be re-encrypted.
  vi.mocked(getCachedTeamKeyVersion).mockReturnValueOnce(2);
  h.status = { stale: false, draining: true };
  h.objects = [
    { object_id: "c1", object_type: "connection", metadata: { v: 2, enc: "old", kv: 2 } },
  ];
  h.secrets = [
    // key_version is undefined here (a pre-#217 row).
    { secret_id: "s1", object_id: "c1", ciphertext: "b64(old-cipher)" } as never,
  ];

  await checkAndRotateTeamKey("t1");

  expect(getTeamVaultKeyAtVersion).toHaveBeenCalledWith("t1", 1);
});

test("draining: does not re-encrypt a secret belonging to a soft-deleted object", async () => {
  h.status = { stale: false, draining: true };
  h.objects = [
    { object_id: "c1", object_type: "connection", metadata: { v: 2, enc: "old", kv: 0 }, deleted_at: "2026-01-01" },
  ];
  h.secrets = [
    { secret_id: "s1", object_id: "c1", ciphertext: "b64(old-cipher)", key_version: 0 },
  ];

  await checkAndRotateTeamKey("t1");

  expect(h.reencryptSecretCalls).toHaveLength(0);
});

test("draining: a failing object batch write does not block the secrets batch that follows", async () => {
  h.status = { stale: false, draining: true };
  h.objects = [
    { object_id: "c1", object_type: "connection", metadata: { v: 2, enc: "old", kv: 0 } },
  ];
  h.secrets = [
    { secret_id: "s1", object_id: "c1", ciphertext: "b64(old-cipher)", key_version: 0 },
  ];
  const { reencryptTeamObjects } = await import("@/services/teamObjects");
  vi.mocked(reencryptTeamObjects).mockRejectedValueOnce(new Error("PUT 500"));

  await expect(checkAndRotateTeamKey("t1")).resolves.toBeUndefined();

  expect(h.reencryptSecretCalls).toHaveLength(1);
});
