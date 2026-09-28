import { test, expect, vi, beforeEach } from "vitest";

type Row = { id: string; vault_id?: string };
const h = vi.hoisted(() => ({
  conn: { connections: [] as Row[], teamConnections: {} as Record<string, Row[]> },
  ident: { identities: [] as Row[], teamIdentities: {} as Record<string, Row[]> },
  key: { keys: [] as Row[], teamKeys: {} as Record<string, Row[]> },
  teams: [] as { id: string }[],
  vaults: [] as { id: string; teamId?: string }[],
}));
vi.mock("@/stores/connectionStore", () => ({ useConnectionStore: { getState: () => h.conn } }));
vi.mock("@/stores/identityStore", () => ({ useIdentityStore: { getState: () => h.ident } }));
vi.mock("@/stores/keyStore", () => ({ useKeyStore: { getState: () => h.key } }));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: { getState: () => ({ teams: h.teams }) } }));
vi.mock("@/stores/vaultStore", () => ({ useVaultStore: { getState: () => ({ vaults: h.vaults }) } }));

import { hasLocalOwner, teamIdOwningSecret, teamObjectSecretKeys } from "./teamSecretOwnership";

beforeEach(() => {
  h.conn = { connections: [], teamConnections: {} };
  h.ident = { identities: [], teamIdentities: {} };
  h.key = { keys: [], teamKeys: {} };
  h.teams = [{ id: "t1" }];
  h.vaults = [{ id: "v-team", teamId: "t1" }, { id: "v-mine" }];
});

test("each secret shape resolves through its own object type", () => {
  h.conn.teamConnections = { t1: [{ id: "c1" }] };
  h.ident.teamIdentities = { t2: [{ id: "i1" }] };
  h.key.teamKeys = { t3: [{ id: "k1" }] };
  expect(teamIdOwningSecret("password:c1")).toBe("t1");
  expect(teamIdOwningSecret("key:c1")).toBe("t1");
  expect(teamIdOwningSecret("passphrase:c1")).toBe("t1");
  expect(teamIdOwningSecret("proxy_password:c1")).toBe("t1");
  expect(teamIdOwningSecret("identity:i1:password")).toBe("t2");
  expect(teamIdOwningSecret("key:k1:private")).toBe("t3");
});

test("personal objects, unknown ids and non-object keys stay local", () => {
  h.conn.connections = [{ id: "c1" }];
  expect(teamIdOwningSecret("password:c1")).toBeNull();
  expect(teamIdOwningSecret("password:nobody")).toBeNull();
  expect(teamIdOwningSecret("proxy_password:__global__")).toBeNull();
  expect(teamIdOwningSecret("plugin:gist:token")).toBeNull();
});

test("a local object sharing a team object's id wins", () => {
  h.key.keys = [{ id: "k1" }];
  h.key.teamKeys = { t1: [{ id: "k1" }] };
  expect(teamIdOwningSecret("key:k1:private")).toBeNull();
});

function seedLocalAndTeamRows(vaultId: string) {
  h.conn.connections = [{ id: "c1", vault_id: vaultId }];
  h.conn.teamConnections = { t1: [{ id: "c1" }] };
  h.key.keys = [{ id: "k1", vault_id: vaultId }];
  h.key.teamKeys = { t1: [{ id: "k1" }] };
  h.ident.identities = [{ id: "i1", vault_id: vaultId }];
  h.ident.teamIdentities = { t1: [{ id: "i1" }] };
}

test.each(["t1", "v-team"])("a local row moved into a team vault (%s) no longer claims its secrets", (vaultId) => {
  seedLocalAndTeamRows(vaultId);
  expect(teamIdOwningSecret("password:c1")).toBe("t1");
  expect(teamIdOwningSecret("key:k1:private")).toBe("t1");
  expect(teamIdOwningSecret("identity:i1:password")).toBe("t1");
  expect(hasLocalOwner("password:c1")).toBe(false);
  expect(teamObjectSecretKeys("t1")).toEqual(expect.arrayContaining([
    "password:c1", "key:k1:private", "identity:i1:password",
  ]));
});

test.each(["personal", "v-mine", "gone-team"])("a local row in a non-team vault (%s) still wins (#249)", (vaultId) => {
  seedLocalAndTeamRows(vaultId);
  expect(teamIdOwningSecret("password:c1")).toBeNull();
  expect(teamIdOwningSecret("key:k1:private")).toBeNull();
  expect(teamIdOwningSecret("identity:i1:password")).toBeNull();
  expect(hasLocalOwner("password:c1")).toBe(true);
  expect(teamObjectSecretKeys("t1")).toEqual([]);
});

test("teamObjectSecretKeys lists every secret of the team's objects, minus local-id collisions", () => {
  h.conn.teamConnections = { t1: [{ id: "c1" }] };
  h.key.teamKeys = { t1: [{ id: "k1" }, { id: "shared" }] };
  h.ident.teamIdentities = { t1: [{ id: "i1" }], t2: [{ id: "i2" }] };
  h.key.keys = [{ id: "shared" }];
  expect(teamObjectSecretKeys("t1").sort()).toEqual([
    "identity:i1:password",
    "key:c1", "key:k1:passphrase", "key:k1:private", "key:k1:public",
    "passphrase:c1", "password:c1", "proxy_password:c1",
  ]);
});

test("missing store slices never throw", () => {
  h.conn = {} as typeof h.conn;
  expect(teamIdOwningSecret("password:c1")).toBeNull();
  expect(teamObjectSecretKeys("t1")).toEqual([]);
});
