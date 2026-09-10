import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  // Stand-in for XChaCha20Poly1305: the Rust command is not available under
  // vitest, so the test asserts the envelope contract and the round trip,
  // not the cipher (which has its own Rust tests).
  encrypted: [] as { files: Record<string, string> }[],
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "encrypt_payload") {
      h.encrypted.push({ files: args.files as Record<string, string> });
      return Array.from(new TextEncoder().encode(JSON.stringify(args.files)));
    }
    if (cmd === "backup_decrypt") {
      const bytes = new Uint8Array(args.blob as number[]);
      return { files: JSON.parse(new TextDecoder().decode(bytes)), secrets: {} };
    }
    throw new Error(`unexpected command ${cmd}`);
  }),
}));

const h2 = vi.hoisted(() => ({ cachedVersion: undefined as number | undefined }));
vi.mock("@/services/teamVaultSync", () => ({
  getTeamVaultKey: vi.fn(async () => new Array(32).fill(7)),
  getCachedTeamKeyVersion: vi.fn((_teamId: string) => h2.cachedVersion),
  getTeamVaultKeyAtVersion: vi.fn(async (_teamId: string, _version: number) => new Array(32).fill(9)),
}));

import {
  encodeObjectMetadata,
  decodeObjectMetadata,
  isEncryptedEnvelope,
} from "./teamObjectEnvelope";
import { getTeamVaultKeyAtVersion } from "@/services/teamVaultSync";

beforeEach(() => {
  h.encrypted = [];
  h2.cachedVersion = undefined;
  vi.mocked(getTeamVaultKeyAtVersion).mockClear();
});

test("round-trips an object through the envelope", async () => {
  const item = { id: "c1", name: "prod-db", host: "10.0.0.1", port: 22, env_vars: { TOKEN: "s3cret" } };

  const envelope = await encodeObjectMetadata("t1", item);
  expect(envelope.v).toBe(2);
  expect(typeof envelope.enc).toBe("string");

  const decoded = await decodeObjectMetadata("t1", envelope);
  expect(decoded).toEqual(item);
});

test("the envelope carries no plaintext from the object", async () => {
  const envelope = await encodeObjectMetadata("t1", { id: "c1", host: "secret-host.internal" });
  expect(envelope.enc).not.toContain("secret-host");
});

test("detects a v2 envelope only when both fields are right", () => {
  expect(isEncryptedEnvelope({ v: 2, enc: "abc" })).toBe(true);
  expect(isEncryptedEnvelope({ v: 2 })).toBe(false);
  expect(isEncryptedEnvelope({ v: 2, enc: 5 })).toBe(false);
  expect(isEncryptedEnvelope({ enc: "abc" })).toBe(false);
  // A legacy object that happens to carry a `v` field is NOT an envelope:
  // it must also carry a string `enc`, or the decode path would hand back
  // garbage instead of the object.
  expect(isEncryptedEnvelope({ id: "c1", v: 2, host: "h" })).toBe(false);
  expect(isEncryptedEnvelope({ id: "c1", host: "h" })).toBe(false);
  expect(isEncryptedEnvelope(null)).toBe(false);
  expect(isEncryptedEnvelope("string")).toBe(false);
});

test("decoding a legacy plaintext object returns it unchanged", async () => {
  const legacy = { id: "c1", host: "10.0.0.1" };
  expect(await decodeObjectMetadata("t1", legacy)).toEqual(legacy);
});

test("decoding a payload with no metadata key throws instead of returning a phantom object", async () => {
  const { invoke } = await import("@tauri-apps/api/core");
  vi.mocked(invoke).mockImplementationOnce(async () => ({ files: {}, secrets: {} }));

  await expect(decodeObjectMetadata("t1", { v: 2, enc: "anything" })).rejects.toThrow();
});

test("encodeObjectMetadata stamps the current cached key version", async () => {
  h2.cachedVersion = 3;
  const envelope = await encodeObjectMetadata("t1", { host: "example" });
  expect(envelope.kv).toBe(3);
});

test("encodeObjectMetadata stamps epoch 1 when nothing is cached yet", async () => {
  h2.cachedVersion = undefined;
  const envelope = await encodeObjectMetadata("t1", { host: "example" });
  expect(envelope.kv).toBe(1);
});

test("decodeObjectMetadata treats a missing kv as epoch 1 and round-trips normally", async () => {
  h2.cachedVersion = 1;
  // A row written before this feature: {v:2, enc} with no kv field at all.
  const item = { id: "c1", host: "10.0.0.1" };
  const envelope = await encodeObjectMetadata("t1", item);
  const { kv: _drop, ...withoutKv } = envelope as typeof envelope & { kv?: number };
  void _drop;

  const decoded = await decodeObjectMetadata("t1", withoutKv);
  expect(decoded).toEqual(item);
  expect(getTeamVaultKeyAtVersion).not.toHaveBeenCalled();
});

test("decodeObjectMetadata reaches for the historical key when kv is behind current", async () => {
  h2.cachedVersion = 1;
  const envelope = await encodeObjectMetadata("t1", { id: "c1" }); // stamped kv:1
  h2.cachedVersion = 3; // team has since rotated to epoch 3

  await decodeObjectMetadata("t1", envelope);

  expect(getTeamVaultKeyAtVersion).toHaveBeenCalledWith("t1", 1);
});

test("decodeObjectMetadata primes a cold cache via getTeamVaultKey BEFORE checking it, still reaching the historical key (C-A)", async () => {
  h2.cachedVersion = 1;
  const envelope = await encodeObjectMetadata("t1", { id: "c1" }); // stamped kv:1

  // Simulate a cold cache at decode time: nothing cached yet. getTeamVaultKey
  // is what primes _teamKeyVersionCache in the real module — reproduce that
  // side effect here, landing on epoch 3 (the team has since rotated).
  h2.cachedVersion = undefined;
  const { getTeamVaultKey } = await import("@/services/teamVaultSync");
  vi.mocked(getTeamVaultKey).mockImplementationOnce(async () => {
    h2.cachedVersion = 3;
    return new Array(32).fill(7);
  });

  await decodeObjectMetadata("t1", envelope);

  // The old, buggy ordering read getCachedTeamKeyVersion synchronously before
  // awaiting getTeamVaultKey, saw `undefined`, and fell through to "use the
  // current key" — never reaching the historical fetch below. The fix awaits
  // getTeamVaultKey (which primes the cache to 3) before reading the cache,
  // so kv:1 is correctly seen as behind and the historical key is fetched.
  expect(getTeamVaultKeyAtVersion).toHaveBeenCalledWith("t1", 1);
});
