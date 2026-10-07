import { test, it, expect } from "vitest";
import {
  teamSecretFromLocalKey,
  localSecretKeyFromTeamSecret,
  secretKeysFor,
  secretObjectKindOf,
  GLOBAL_PROXY_PASSWORD_KEY,
  type TeamSecretType,
} from "./teamVaultSecretKeys";

/** Every local secret key shape the app writes, and the type it must map to. */
const SHAPES: [localKey: string, objectId: string, secretType: TeamSecretType][] = [
  ["password:conn1", "conn1", "connection_password"],
  ["key:conn1", "conn1", "connection_key"],
  ["passphrase:conn1", "conn1", "connection_passphrase"],
  ["proxy_password:conn1", "conn1", "connection_proxy_password"],
  ["knock_sequence:conn1", "conn1", "connection_knock_sequence"],
  ["identity:id1:password", "id1", "identity_password"],
  ["key:key1:private", "key1", "key_private"],
  ["key:key1:public", "key1", "key_public"],
  ["key:key1:passphrase", "key1", "key_passphrase"],
];

test.each(SHAPES)("%s maps to its team secret type", (localKey, objectId, secretType) => {
  expect(teamSecretFromLocalKey(localKey)).toEqual({ secretId: localKey, objectId, secretType });
});

test.each(SHAPES)("%s survives a round trip through the team representation", (localKey, objectId, secretType) => {
  expect(localSecretKeyFromTeamSecret(objectId, secretType)).toBe(localKey);
});

/**
 * An unmapped shape is not an error anyone sees: saveTeamVaultSecret returns
 * early and every caller swallows it, so the secret silently never reaches the
 * vault. That is how connection passphrases went missing for team members.
 */
test("an unrecognised local key is reported as null rather than guessed at", () => {
  expect(teamSecretFromLocalKey("nonsense:conn1")).toBeNull();
  expect(teamSecretFromLocalKey("passphrase:")).toBeNull();
  expect(localSecretKeyFromTeamSecret("conn1", "not_a_type")).toBeNull();
});

/** A connection's own passphrase and a keychain key's passphrase are different
 *  secrets with different owners; mapping one onto the other would publish a
 *  passphrase under an id that no member can resolve. */
test("connection and keychain passphrases stay distinct", () => {
  expect(teamSecretFromLocalKey("passphrase:x")?.secretType).toBe("connection_passphrase");
  expect(teamSecretFromLocalKey("key:x:passphrase")?.secretType).toBe("key_passphrase");
  expect(localSecretKeyFromTeamSecret("x", "connection_passphrase")).toBe("passphrase:x");
  expect(localSecretKeyFromTeamSecret("x", "key_passphrase")).toBe("key:x:passphrase");
});

it("never maps the global proxy password to a team secret", () => {
  expect(teamSecretFromLocalKey(GLOBAL_PROXY_PASSWORD_KEY)).toBeNull();
});

it("never maps a team-written __global__ object id back onto this device's global proxy password", () => {
  expect(localSecretKeyFromTeamSecret("__global__", "connection_proxy_password")).toBeNull();
});

test("every kind's secret keys parse back to that kind and object", () => {
  expect(secretKeysFor("key", "k1")).toEqual(["key:k1:private", "key:k1:public", "key:k1:passphrase"]);
  expect(secretKeysFor("identity", "i1")).toEqual(["identity:i1:password"]);
  for (const kind of ["connection", "key", "identity"] as const) {
    for (const k of secretKeysFor(kind, "o1")) {
      const parts = teamSecretFromLocalKey(k);
      expect(parts?.objectId).toBe("o1");
      expect(secretObjectKindOf(parts!.secretType)).toBe(kind);
    }
  }
});

test("every connection secret key cascades with the connection", () => {
  expect(secretKeysFor("connection", "c")).toEqual(["password:c", "key:c", "passphrase:c", "proxy_password:c", "knock_sequence:c"]);
});
