import { beforeEach, test, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { Connection } from "@/types";

const h = vi.hoisted(() => ({
  status: "loaded",
  denied: new Set<string>(),
  fromState: (state: () => object) => (sel: (s: object) => unknown) => sel(state()),
}));

vi.mock("@/stores/identityStore", () => ({ useIdentityStore: h.fromState(() => ({ identities: [{ id: "own", username: "alice" }], teamIdentities: {} })) }));
vi.mock("@/stores/keyStore", () => ({ useKeyStore: h.fromState(() => ({ teamKeys: {} })) }));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: h.fromState(() => ({ teams: [{ id: "t1", name: "Ops" }] })) }));
vi.mock("@/stores/vaultStore", () => ({ useVaultStore: h.fromState(() => ({ vaults: [] })) }));
vi.mock("@/stores/identityPickStore", () => ({
  useIdentityPickStore: h.fromState(() => ({ status: h.status, byObject: {}, byTeam: { t1: "own" } })),
}));
vi.mock("@/hooks/usePermission", () => ({ usePermissions: () => (_p: string, _v: string, o?: string) => !h.denied.has(o ?? "") }));

import { teamSecretCache } from "@/services/teamSecretCache";
import { useCredentialPlan } from "./useCredentialPlan";

const host = (over: Partial<Connection> = {}) => ({ id: "c1", vault_id: "t1", connection_type: "ssh", username: "root", host: "db-01", ...over }) as Connection;
const offered = (conn: Connection) => renderHook(() => useCredentialPlan(conn)).result.current.picksOffered;

beforeEach(() => {
  h.status = "loaded";
  h.denied = new Set();
  teamSecretCache.replaceTeam("t1", new Map());
});

test("picks are offered on an SSH team host the member can connect to", () => {
  expect(offered(host())).toBe(true);
  expect(offered(host({ connection_type: undefined }))).toBe(true);
});

test.each([
  ["an FTP host", host({ connection_type: "ftp" })],
  ["a serial host", host({ connection_type: "serial" })],
  ["a personal host", host({ vault_id: "personal" })],
])("%s never offers picks", (_label, conn) => {
  expect(offered(conn)).toBe(false);
});

test("no Connect on the host closes the gate", () => {
  h.denied = new Set(["c1"]);
  expect(offered(host())).toBe(false);
});

test.each(["unsupported", "unknown"])("the gate stays closed while picks are %s", (status) => {
  h.status = status;
  expect(offered(host())).toBe(false);
});

test("an FTP team host with a vault default still plans the host credential", () => {
  expect(renderHook(() => useCredentialPlan(host({ connection_type: "ftp" }))).result.current.plan).toEqual({ kind: "host" });
  expect(renderHook(() => useCredentialPlan(host())).result.current.plan.kind).toBe("default");
});

test("the plan recomputes once the team's secrets hydrate", () => {
  teamSecretCache.clearAll();
  const { result } = renderHook(() => useCredentialPlan(host()));
  expect(result.current.plan).toEqual({ kind: "host" });
  act(() => teamSecretCache.replaceTeam("t1", new Map()));
  expect(result.current.plan.kind).toBe("default");
});

test("a shared password that arrives with the secrets keeps the host credential", () => {
  teamSecretCache.clearAll();
  const { result } = renderHook(() => useCredentialPlan(host()));
  act(() => teamSecretCache.replaceTeam("t1", new Map([["password:c1", "pw"]])));
  expect(result.current.plan).toEqual({ kind: "host" });
});
