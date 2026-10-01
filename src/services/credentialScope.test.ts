import { describe, test, expect } from "vitest";
import type { Identity, SshKey } from "@/types";
import { planCredentials } from "./credentialPlan";
import {
  buildCredentialScope,
  describePickIssue,
  effectiveUsername,
  pickChoices,
  pickGroups,
  type Can,
  type CredentialSnapshot,
} from "./credentialScope";

const ident = (id: string, over: Partial<Identity> = {}) => ({ id, username: id, tags: [], ...over }) as Identity;
const own = ident("own", { name: "Alice (laptop key)", username: "alice" });
const shared = ident("shared", { name: "ops-deploy", username: "deploy", key_id: "k1" });
const keyless = ident("keyless", { username: "svc" });
const key = { id: "k1", name: "ops-deploy-ed25519" } as SshKey;

const snapshot = (over: Partial<CredentialSnapshot> = {}): CredentialSnapshot => ({
  teams: [{ id: "t1", name: "Ops" }],
  vaults: [],
  ownIdentities: [own],
  teamIdentities: { t1: [shared, keyless] },
  teamKeys: { t1: [key] },
  picks: { byObject: {}, byTeam: {} },
  teamSecret: () => undefined,
  secretsHydrated: () => true,
  ...over,
});
const allow: Can = () => true;
const teamHost = { id: "h1", vault_id: "t1", username: "root", host: "db-01", name: "db-01" };

describe("buildCredentialScope", () => {
  test("a personal host gets a personal scope even with stray picks", () => {
    const s = buildCredentialScope({ ...teamHost, vault_id: "personal" }, snapshot({ picks: { byObject: { h1: "own" }, byTeam: {} } }), allow);
    expect(planCredentials(s)).toEqual({ kind: "host" });
  });

  test("shared credential follows today's rules", () => {
    expect(buildCredentialScope(teamHost, snapshot(), allow).hostHasSharedCredential).toBe(false);
    expect(buildCredentialScope({ ...teamHost, key_id: "k9" }, snapshot(), allow).hostHasSharedCredential).toBe(true);
    expect(buildCredentialScope({ ...teamHost, identity_id: "shared" }, snapshot(), allow).hostHasSharedCredential).toBe(true);
    expect(buildCredentialScope({ ...teamHost, identity_id: "hidden" }, snapshot(), allow).hostHasSharedCredential).toBe(false);
    const withSecret = snapshot({ teamSecret: (t, k) => (t === "t1" && k === "password:h1" ? "pw" : undefined) });
    expect(buildCredentialScope(teamHost, withSecret, allow).hostHasSharedCredential).toBe(true);
  });

  test("own identities are always usable; team ones need CONNECT on identity and key", () => {
    const denyKey: Can = (_p, _v, o) => o !== "k1";
    const s = buildCredentialScope(teamHost, snapshot(), denyKey);
    expect(s.lookup("own")).toEqual(own);
    expect(s.lookup("shared")).toBe("forbidden");
    expect(s.lookup("keyless")).toEqual(keyless);
    expect(s.lookup("nope")).toBe("missing");
  });

  test("a team identity whose key is not loaded is forbidden, never used without its key", () => {
    const s = buildCredentialScope(teamHost, snapshot({ teamKeys: { t1: [] } }), allow);
    expect(s.lookup("shared")).toBe("forbidden");
  });

  test("another team's identity is not usable here", () => {
    const s = buildCredentialScope(teamHost, snapshot({ teamIdentities: { t1: [], t2: [shared] } }), allow);
    expect(s.lookup("shared")).toBe("missing");
  });

  test.each(["ftp", "serial"] as const)("a %s team host ignores picks and the vault default", (type) => {
    const picks = { byObject: { h1: "own" }, byTeam: { t1: "keyless" } };
    const s = buildCredentialScope({ ...teamHost, connection_type: type }, snapshot({ picks }), allow);
    expect(s.teamId).toBe("t1");
    expect(planCredentials(s)).toEqual({ kind: "host" });
  });

  test("the vault default waits for the team's secrets, so a stored host password is not overridden at startup", () => {
    const picks = { byObject: {}, byTeam: { t1: "keyless" } };
    const before = buildCredentialScope(teamHost, snapshot({ picks, secretsHydrated: () => false }), allow);
    expect(planCredentials(before)).toEqual({ kind: "host" });
    const after = buildCredentialScope(teamHost, snapshot({ picks }), allow);
    expect(planCredentials(after)).toEqual({ kind: "default", identity: keyless });
  });

  test("a host pick applies before the team's secrets hydrate", () => {
    const s = buildCredentialScope(teamHost, snapshot({ picks: { byObject: { h1: "own" }, byTeam: {} }, secretsHydrated: () => false }), allow);
    expect(planCredentials(s)).toEqual({ kind: "pick", identity: own });
  });

  test("picks are read per host and per team", () => {
    const s = buildCredentialScope(teamHost, snapshot({ picks: { byObject: { h1: "own" }, byTeam: { t1: "keyless" } } }), allow);
    expect(s.hostPickId).toBe("own");
    expect(s.vaultDefaultId).toBe("keyless");
  });
});

test("pickChoices lists own identities then usable team identities", () => {
  const denyKey: Can = (_p, _v, o) => o !== "k1";
  expect(pickChoices("t1", snapshot(), denyKey).map((c) => c.id)).toEqual(["own", "keyless"]);
  const groups = pickGroups("t1", snapshot(), denyKey);
  expect([groups.own.map((c) => c.id), groups.shared.map((c) => c.id)]).toEqual([["own"], ["keyless"]]);
});

test("describePickIssue names the host, the identity when known, and the fallback", () => {
  const host = { ...teamHost, identity_id: "shared" };
  const issue = describePickIssue(
    host,
    { kind: "unavailable", via: "pick", identityId: "keyless", reason: "forbidden", hasFallback: true },
    snapshot(),
  );
  expect(issue).toEqual({
    connectionId: "h1", connectionName: "db-01", via: "pick", reason: "forbidden",
    identityName: "svc", hasFallback: true, fallbackName: "ops-deploy",
  });
  expect(
    describePickIssue(host, { kind: "unavailable", via: "pick", identityId: "gone", reason: "missing", hasFallback: false }, snapshot()).identityName,
  ).toBeUndefined();
});

test("effectiveUsername shows the picked identity's user", () => {
  expect(effectiveUsername({ username: "root" }, { kind: "pick", identity: own })).toBe("alice");
  expect(effectiveUsername({ username: "root" }, { kind: "host" })).toBe("root");
});
