import test from "node:test";
import assert from "node:assert/strict";
import { resolveCredentials } from "../src/services/credentialLogic.ts";

const NO_IDENTITY = () => Promise.resolve(undefined);

function makeSecrets(map: Record<string, string>) {
  return (key: string) => Promise.resolve(map[key] ?? null);
}

test("user+pass: resolves password from vault by connection id", async () => {
  const conn = { id: "c1", username: "alice" };
  const result = await resolveCredentials(conn, NO_IDENTITY, makeSecrets({ "password:c1": "s3cr3t" }));
  assert.deepEqual(result, { username: "alice", password: "s3cr3t", privateKey: undefined, passphrase: undefined });
});

test("user+key inline: resolves private key stored directly under connection id", async () => {
  const conn = { id: "c2", username: "alice" };
  const result = await resolveCredentials(conn, NO_IDENTITY, makeSecrets({ "key:c2": "PRIVATE_KEY" }));
  assert.deepEqual(result, { username: "alice", password: undefined, privateKey: "PRIVATE_KEY", passphrase: undefined });
});

test("user+key object: resolves private key stored under key_id", async () => {
  const conn = { id: "c3", username: "alice", key_id: "k1" };
  const result = await resolveCredentials(conn, NO_IDENTITY, makeSecrets({ "key:k1:private": "PRIVATE_KEY" }));
  assert.deepEqual(result, { username: "alice", password: undefined, privateKey: "PRIVATE_KEY", passphrase: undefined });
});

test("user+key+passphrase: resolves key and passphrase from vault", async () => {
  const conn = { id: "c4", username: "alice", key_id: "k1" };
  const result = await resolveCredentials(
    conn,
    NO_IDENTITY,
    makeSecrets({ "key:k1:private": "PRIVATE_KEY", "key:k1:passphrase": "PASS" }),
  );
  assert.deepEqual(result, { username: "alice", password: undefined, privateKey: "PRIVATE_KEY", passphrase: "PASS" });
});

test("user+identity(key): resolves username and key from identity, ignores connection username", async () => {
  const conn = { id: "c5", username: "conn-user", identity_id: "id1" };
  const findIdentity = (id: string) => Promise.resolve(id === "id1" ? { username: "alice", key_id: "k1" } : undefined);
  const result = await resolveCredentials(conn, findIdentity, makeSecrets({ "key:k1:private": "PRIVATE_KEY" }));
  assert.deepEqual(result, { username: "alice", password: undefined, privateKey: "PRIVATE_KEY", passphrase: undefined });
});

test("user+identity(key+passphrase): resolves username, key and passphrase from identity", async () => {
  const conn = { id: "c6", username: "conn-user", identity_id: "id1" };
  const findIdentity = (id: string) => Promise.resolve(id === "id1" ? { username: "alice", key_id: "k1" } : undefined);
  const result = await resolveCredentials(
    conn,
    findIdentity,
    makeSecrets({ "key:k1:private": "PRIVATE_KEY", "key:k1:passphrase": "PASS" }),
  );
  assert.deepEqual(result, { username: "alice", password: undefined, privateKey: "PRIVATE_KEY", passphrase: "PASS" });
});

test("user+identity(pass): resolves username and password from identity", async () => {
  const conn = { id: "c7", username: "conn-user", identity_id: "id1" };
  const findIdentity = (id: string) => Promise.resolve(id === "id1" ? { username: "alice" } : undefined);
  const result = await resolveCredentials(conn, findIdentity, makeSecrets({ "identity:id1:password": "PWD" }));
  assert.deepEqual(result, { username: "alice", password: "PWD", privateKey: undefined, passphrase: undefined });
});
