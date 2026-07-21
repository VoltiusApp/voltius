import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ invoke: vi.fn(), getVaultKey: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/vault", () => ({ getVaultKey: h.getVaultKey }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));

import {
  getMyX25519Keypair,
  wrapSessionKeyForUser,
  unwrapSessionKey,
  importSessionKey,
  encryptData,
  decryptData,
  clearKeypairCache,
} from "./multiplayerService";

beforeEach(() => {
  h.invoke.mockReset();
  h.getVaultKey.mockReset();
  clearKeypairCache();
});

test("getMyX25519Keypair derives once and caches", async () => {
  h.getVaultKey.mockReturnValue(new Uint8Array([1, 2, 3]));
  h.invoke.mockResolvedValue({ public_key: "PUB", private_key: "PRIV" });

  const a = await getMyX25519Keypair();
  const b = await getMyX25519Keypair();

  expect(a).toEqual({ privateKey: "PRIV", publicKey: "PUB" });
  expect(b).toEqual(a);
  expect(h.invoke).toHaveBeenCalledTimes(1);
  expect(h.invoke).toHaveBeenCalledWith("derive_x25519_keypair", { encKey: new Uint8Array([1, 2, 3]) });
});

test("getMyX25519Keypair throws when the vault is locked", async () => {
  h.getVaultKey.mockReturnValue(null);
  await expect(getMyX25519Keypair()).rejects.toThrow("common.error.vaultLocked");
});

test("wrapSessionKeyForUser forwards the right invoke shape", async () => {
  h.getVaultKey.mockReturnValue(new Uint8Array([1]));
  h.invoke.mockImplementation(async (cmd: string) =>
    cmd === "derive_x25519_keypair" ? { public_key: "PUB", private_key: "PRIV" } : "WRAPPED",
  );
  const out = await wrapSessionKeyForUser(new Uint8Array([5, 6]), "RECIP");
  expect(out).toBe("WRAPPED");
  expect(h.invoke).toHaveBeenCalledWith("x25519_wrap_key", {
    myPrivateKeyB64: "PRIV",
    recipientPublicKeyB64: "RECIP",
    plaintext: [5, 6],
  });
});

test("unwrapSessionKey returns a Uint8Array from the returned number[]", async () => {
  h.getVaultKey.mockReturnValue(new Uint8Array([1]));
  h.invoke.mockImplementation(async (cmd: string) =>
    cmd === "derive_x25519_keypair" ? { public_key: "PUB", private_key: "PRIV" } : [1, 2, 3],
  );
  const out = await unwrapSessionKey("WRAPPED", "SENDER");
  expect(Array.from(out)).toEqual([1, 2, 3]);
  expect(h.invoke).toHaveBeenCalledWith("x25519_unwrap_key", {
    myPrivateKeyB64: "PRIV",
    senderPublicKeyB64: "SENDER",
    wrappedB64: "WRAPPED",
  });
});

test("importSessionKey enforces a 32-byte key", async () => {
  await expect(importSessionKey(new Uint8Array(31))).rejects.toThrow("common.error.invalidSessionKey");
  await expect(importSessionKey(new Uint8Array(32))).resolves.toHaveLength(32);
});

test("encryptData then decryptData round-trips via real xchacha", async () => {
  const key = await importSessionKey(new Uint8Array(32).fill(4));
  const plaintext = new TextEncoder().encode("secret payload");
  const b64 = await encryptData(key, plaintext);
  expect(typeof b64).toBe("string");
  expect(Array.from(await decryptData(key, b64))).toEqual(Array.from(plaintext));
});
