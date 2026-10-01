import { test, expect, beforeEach } from "vitest";
import { teamSecretCache, useTeamSecretsHydrated } from "./teamSecretCache";

beforeEach(() => teamSecretCache.clearAll());

test("values are scoped per team", () => {
  teamSecretCache.set("t1", "password:c1", "a");
  teamSecretCache.set("t2", "password:c1", "b");
  expect(teamSecretCache.get("t1", "password:c1")).toBe("a");
  expect(teamSecretCache.get("t2", "password:c1")).toBe("b");
});

test("replaceTeam drops every key not in the new set and leaves other teams alone", () => {
  teamSecretCache.set("t1", "password:gone", "x");
  teamSecretCache.set("t2", "password:other", "y");
  teamSecretCache.replaceTeam("t1", new Map([["password:c1", "pw"]]));
  expect(teamSecretCache.get("t1", "password:gone")).toBeUndefined();
  expect(teamSecretCache.get("t1", "password:c1")).toBe("pw");
  expect(teamSecretCache.get("t2", "password:other")).toBe("y");
});

test("entries returns a copy the caller cannot use to mutate the cache", () => {
  teamSecretCache.set("t1", "password:c1", "pw");
  teamSecretCache.entries("t1").set("password:c1", "tampered");
  expect(teamSecretCache.get("t1", "password:c1")).toBe("pw");
});

test("clearTeam and clearAll", () => {
  teamSecretCache.set("t1", "k", "1");
  teamSecretCache.set("t2", "k", "2");
  teamSecretCache.clearTeam("t1");
  expect(teamSecretCache.get("t1", "k")).toBeUndefined();
  expect(teamSecretCache.get("t2", "k")).toBe("2");
  teamSecretCache.clearAll();
  expect(teamSecretCache.get("t2", "k")).toBeUndefined();
});

test("delete removes one key", () => {
  teamSecretCache.set("t1", "a", "1");
  teamSecretCache.set("t1", "b", "2");
  teamSecretCache.delete("t1", "a");
  expect(teamSecretCache.get("t1", "a")).toBeUndefined();
  expect(teamSecretCache.get("t1", "b")).toBe("2");
});

test("a team counts as hydrated from replaceTeam until it is cleared", () => {
  expect(teamSecretCache.isHydrated("t1")).toBe(false);
  teamSecretCache.set("t1", "k", "1");
  expect(teamSecretCache.isHydrated("t1")).toBe(false);
  teamSecretCache.replaceTeam("t1", new Map());
  expect(teamSecretCache.isHydrated("t1")).toBe(true);
  const version = useTeamSecretsHydrated.getState().byTeam.t1;
  teamSecretCache.set("t1", "k", "2");
  expect(useTeamSecretsHydrated.getState().byTeam.t1).toBe(version + 1);
  teamSecretCache.clearTeam("t1");
  expect(teamSecretCache.isHydrated("t1")).toBe(false);
  teamSecretCache.replaceTeam("t2", new Map());
  teamSecretCache.clearAll();
  expect(teamSecretCache.isHydrated("t2")).toBe(false);
});
