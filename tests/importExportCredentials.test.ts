import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchConnectionSecrets,
  storeConnectionSecrets,
  fetchIdentitySecrets,
  storeIdentitySecrets,
  fetchKeySecrets,
  storeKeySecrets,
  resolveConnectionKeyEid,
  resolveConnectionKeyId,
} from "../src/services/import-export/secretsLogic.ts";

function makeVault(map: Record<string, string>) {
  return (key: string) => Promise.resolve(map[key] ?? null);
}

async function roundTripConnection(sourceId: string, newId: string, vault: Record<string, string>) {
  const record = await fetchConnectionSecrets(sourceId, makeVault(vault));
  const dest: Record<string, string> = {};
  await storeConnectionSecrets(record, newId, (k, v) => { dest[k] = v; return Promise.resolve(); });
  return dest;
}

async function roundTripIdentity(sourceId: string, newId: string, vault: Record<string, string>) {
  const record = await fetchIdentitySecrets(sourceId, makeVault(vault));
  const dest: Record<string, string> = {};
  await storeIdentitySecrets(record, newId, (k, v) => { dest[k] = v; return Promise.resolve(); });
  return dest;
}

async function roundTripKey(sourceId: string, newId: string, vault: Record<string, string>) {
  const record = await fetchKeySecrets(sourceId, makeVault(vault));
  const dest: Record<string, string> = {};
  await storeKeySecrets(record, newId, (k, v) => { dest[k] = v; return Promise.resolve(); });
  return dest;
}

// ─── connection: user+pass ────────────────────────────────────────────────────

test("user+pass: password is faithfully round-tripped", async () => {
  const dest = await roundTripConnection("old", "new", { "password:old": "s3cr3t" });
  assert.deepEqual(dest, { "password:new": "s3cr3t" });
});

// ─── connection: user+key inline ──────────────────────────────────────────────

test("user+key inline: private key is faithfully round-tripped", async () => {
  const dest = await roundTripConnection("old", "new", { "key:old": "PRIVATE_KEY" });
  assert.deepEqual(dest, { "key:new": "PRIVATE_KEY" });
});

// ─── connection: user+key+passphrase inline ───────────────────────────────────

test("user+key+passphrase: key and passphrase are faithfully round-tripped", async () => {
  const dest = await roundTripConnection("old", "new", {
    "key:old": "PRIVATE_KEY",
    "passphrase:old": "PASS",
  });
  assert.deepEqual(dest, { "key:new": "PRIVATE_KEY", "passphrase:new": "PASS" });
});

// ─── identity: user+identity(pass) ───────────────────────────────────────────

test("identity+pass: password is faithfully round-tripped", async () => {
  const dest = await roundTripIdentity("old-id", "new-id", { "identity:old-id:password": "PWD" });
  assert.deepEqual(dest, { "identity:new-id:password": "PWD" });
});

// ─── key: user+identity(key) — key without passphrase ────────────────────────

test("identity+key: private and public keys are faithfully round-tripped", async () => {
  const dest = await roundTripKey("old-k", "new-k", {
    "key:old-k:private": "PRIVATE_KEY",
    "key:old-k:public": "PUBLIC_KEY",
  });
  assert.deepEqual(dest, { "key:new-k:private": "PRIVATE_KEY", "key:new-k:public": "PUBLIC_KEY" });
});

// ─── key: user+identity(key+passphrase) ──────────────────────────────────────

test("identity+key+passphrase: private key, public key and passphrase are faithfully round-tripped", async () => {
  const dest = await roundTripKey("old-k", "new-k", {
    "key:old-k:private": "PRIVATE_KEY",
    "key:old-k:public": "PUBLIC_KEY",
    "key:old-k:passphrase": "PASS",
  });
  assert.deepEqual(dest, {
    "key:new-k:private": "PRIVATE_KEY",
    "key:new-k:public": "PUBLIC_KEY",
    "key:new-k:passphrase": "PASS",
  });
});

// ─── user+key object: _key_eid round-trip ────────────────────────────────────
// Regression: connections with key_id were exported without _key_eid, so the
// linked key was silently dropped on import (key_id would point to a stale ID).

test("user+key object export: key_id is mapped to _key_eid via keyEidMap", () => {
  const keyEidMap = new Map([["original-key-id", "k0"]]);
  assert.equal(resolveConnectionKeyEid("original-key-id", keyEidMap), "k0");
});

test("user+key object import: _key_eid is resolved to new key_id via keyEidMap", () => {
  const keyEidMap = new Map([["k0", "new-key-id"]]);
  assert.equal(resolveConnectionKeyId("k0", keyEidMap), "new-key-id");
});

test("user+key object full round-trip: key_id is faithfully restored after export→import", () => {
  // Simulate export: original key "original-key-id" gets _eid "k0"
  const exportKeyEidMap = new Map([["original-key-id", "k0"]]);
  const keyEid = resolveConnectionKeyEid("original-key-id", exportKeyEidMap);
  assert.equal(keyEid, "k0");

  // Simulate import: key "k0" was saved as "new-key-id"
  const importKeyEidMap = new Map([["k0", "new-key-id"]]);
  const restoredKeyId = resolveConnectionKeyId(keyEid, importKeyEidMap);
  assert.equal(restoredKeyId, "new-key-id");
});

test("user+key object: undefined key_id produces no _key_eid", () => {
  assert.equal(resolveConnectionKeyEid(undefined, new Map()), undefined);
});

// ─── absence guarantees: missing secrets produce no vault entries ─────────────

test("missing password produces no vault entry on import", async () => {
  const dest = await roundTripConnection("old", "new", {});
  assert.deepEqual(dest, {});
});

test("missing key passphrase produces no passphrase entry on import", async () => {
  const dest = await roundTripKey("old-k", "new-k", { "key:old-k:private": "PRIVATE_KEY" });
  assert.deepEqual(dest, { "key:new-k:private": "PRIVATE_KEY" });
});
