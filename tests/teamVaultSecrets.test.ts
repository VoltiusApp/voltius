import test from "node:test";
import assert from "node:assert/strict";
import {
  localSecretKeyFromTeamSecret,
  teamSecretFromLocalKey,
} from "../src/services/teamVaultSecretKeys.ts";

test("maps connection password and key secrets to team secret records", () => {
  assert.deepEqual(teamSecretFromLocalKey("password:conn-1"), {
    secretId: "password:conn-1",
    objectId: "conn-1",
    secretType: "connection_password",
  });
  assert.deepEqual(teamSecretFromLocalKey("key:conn-1"), {
    secretId: "key:conn-1",
    objectId: "conn-1",
    secretType: "connection_key",
  });
});

test("maps identity and ssh key secrets to team secret records", () => {
  assert.deepEqual(teamSecretFromLocalKey("identity:identity-1:password"), {
    secretId: "identity:identity-1:password",
    objectId: "identity-1",
    secretType: "identity_password",
  });
  assert.deepEqual(teamSecretFromLocalKey("key:key-1:private"), {
    secretId: "key:key-1:private",
    objectId: "key-1",
    secretType: "key_private",
  });
});

test("maps server team secrets back to local keychain keys", () => {
  assert.equal(localSecretKeyFromTeamSecret("conn-1", "connection_password"), "password:conn-1");
  assert.equal(localSecretKeyFromTeamSecret("conn-1", "connection_key"), "key:conn-1");
  assert.equal(localSecretKeyFromTeamSecret("identity-1", "identity_password"), "identity:identity-1:password");
  assert.equal(localSecretKeyFromTeamSecret("key-1", "key_private"), "key:key-1:private");
});
