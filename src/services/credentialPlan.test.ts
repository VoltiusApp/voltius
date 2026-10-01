import { describe, test, expect } from "vitest";
import {
  IdentityPickUnavailableError,
  identityPickIssueOf,
  planCredentials,
  type CredentialScope,
  type PickTarget,
} from "./credentialPlan";

const own: PickTarget = { id: "own", username: "alice", name: "Alice (laptop key)", key_id: "k-own" };
const team: PickTarget = { id: "team", username: "deploy", name: "ops-deploy", key_id: "k-team" };
const table: Record<string, PickTarget | "missing" | "forbidden"> = { own, team, gone: "missing", denied: "forbidden" };

const scope = (over: Partial<CredentialScope> = {}): CredentialScope => ({
  teamId: "t1",
  hostPickId: null,
  vaultDefaultId: null,
  hostHasSharedCredential: false,
  lookup: (id) => table[id] ?? "missing",
  ...over,
});

describe("planCredentials", () => {
  test("a personal host never consults picks", () => {
    expect(planCredentials(scope({ teamId: null, hostPickId: "own", vaultDefaultId: "own" }))).toEqual({ kind: "host" });
  });

  test("no picks means today's path, with or without a shared credential", () => {
    expect(planCredentials(scope())).toEqual({ kind: "host" });
    expect(planCredentials(scope({ hostHasSharedCredential: true }))).toEqual({ kind: "host" });
  });

  test("a usable host pick wins over the shared credential", () => {
    expect(planCredentials(scope({ hostPickId: "own", hostHasSharedCredential: true }))).toEqual({ kind: "pick", identity: own });
  });

  test("an unusable host pick stops, and says whether the shared credential can stand in", () => {
    expect(planCredentials(scope({ hostPickId: "gone", hostHasSharedCredential: true }))).toEqual({
      kind: "unavailable", via: "pick", identityId: "gone", reason: "missing", hasFallback: true,
    });
    expect(planCredentials(scope({ hostPickId: "denied" }))).toEqual({
      kind: "unavailable", via: "pick", identityId: "denied", reason: "forbidden", hasFallback: false,
    });
  });

  test("skipPick ignores the host pick for one attempt only", () => {
    expect(planCredentials(scope({ hostPickId: "gone", hostHasSharedCredential: true }), { skipPick: true })).toEqual({ kind: "host" });
  });

  test("the vault default only applies when the host has no shared credential", () => {
    expect(planCredentials(scope({ vaultDefaultId: "own", hostHasSharedCredential: true }))).toEqual({ kind: "host" });
    expect(planCredentials(scope({ vaultDefaultId: "own" }))).toEqual({ kind: "default", identity: own });
  });

  test("an unusable vault default stops without a fallback", () => {
    expect(planCredentials(scope({ vaultDefaultId: "denied" }))).toEqual({
      kind: "unavailable", via: "default", identityId: "denied", reason: "forbidden", hasFallback: false,
    });
  });
});

test("identityPickIssueOf recognises only the typed error", () => {
  const issue = { connectionId: "c1", connectionName: "db-01", via: "pick" as const, reason: "missing" as const, hasFallback: false };
  expect(identityPickIssueOf(new IdentityPickUnavailableError(issue, "x"))).toEqual(issue);
  expect(identityPickIssueOf(new Error("x"))).toBeUndefined();
});
