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

vi.mock("@/services/teamVaultSync", () => ({
  getTeamVaultKey: vi.fn(async () => new Array(32).fill(7)),
}));

import {
  encodeObjectMetadata,
  decodeObjectMetadata,
  isEncryptedEnvelope,
} from "./teamObjectEnvelope";

beforeEach(() => {
  h.encrypted = [];
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
  await encodeObjectMetadata("t1", { id: "c1", host: "secret-host.internal" });

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
