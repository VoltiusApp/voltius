import { test, expect, afterEach } from "vitest";
import {
  setEphemeralCredentials,
  clearEphemeralCredentials,
  withEphemeralCredentials,
} from "../src/services/ephemeralCredentials.ts";

afterEach(() => {
  clearEphemeralCredentials("e1");
  clearEphemeralCredentials("c1");
});

test("no cached auth: resolution passes through untouched", () => {
  const resolved = { username: "alice", password: undefined, privateKey: undefined, passphrase: undefined };
  expect(withEphemeralCredentials("e1", resolved)).toEqual(resolved);
});

test("quick-connect password survives for a second session on the same ephemeral id", () => {
  setEphemeralCredentials("e1", { username: "voltius", password: "not-a-real-password" });
  // What the vault returns for an unsaved host: nothing but the record's username.
  const resolved = { username: "voltius", password: undefined, privateKey: undefined, passphrase: undefined };
  expect(withEphemeralCredentials("e1", resolved)).toEqual({
    username: "voltius",
    password: "not-a-real-password",
    privateKey: undefined,
    passphrase: undefined,
  });
});

test("caches key and passphrase too", () => {
  setEphemeralCredentials("e1", { username: "alice", privateKey: "not-a-real-private-key", passphrase: "not-a-real-passphrase" });
  const resolved = { username: "alice", password: undefined, privateKey: undefined, passphrase: undefined };
  expect(withEphemeralCredentials("e1", resolved)).toEqual({
    username: "alice",
    password: undefined,
    privateKey: "not-a-real-private-key",
    passphrase: "not-a-real-passphrase",
  });
});

test("overlay username wins over the stale ephemeral record username", () => {
  setEphemeralCredentials("e1", { username: "typed-user", password: "not-a-real-password" });
  const resolved = { username: "record-user", password: undefined, privateKey: undefined, passphrase: undefined };
  expect(withEphemeralCredentials("e1", resolved).username).toBe("typed-user");
});

test("stored vault secret wins over a cached one for a saved host", () => {
  setEphemeralCredentials("c1", { username: "alice", password: "not-a-real-stale-password" });
  const resolved = { username: "alice", password: "from-vault", privateKey: undefined, passphrase: undefined };
  expect(withEphemeralCredentials("c1", resolved).password).toBe("from-vault");
});

test("clearing drops the cached auth", () => {
  setEphemeralCredentials("e1", { username: "voltius", password: "not-a-real-password" });
  clearEphemeralCredentials("e1");
  const resolved = { username: "voltius", password: undefined, privateKey: undefined, passphrase: undefined };
  expect(withEphemeralCredentials("e1", resolved).password).toBeUndefined();
});
