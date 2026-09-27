import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  conn: { connections: [] as { id: string }[], teamConnections: {} as Record<string, { id: string }[]> },
  ident: { identities: [] as { id: string }[], teamIdentities: {} as Record<string, { id: string }[]> },
  key: { keys: [] as { id: string }[], teamKeys: {} as Record<string, { id: string }[]> },
}));
vi.mock("@/stores/connectionStore", () => ({ useConnectionStore: { getState: () => h.conn } }));
vi.mock("@/stores/identityStore", () => ({ useIdentityStore: { getState: () => h.ident } }));
vi.mock("@/stores/keyStore", () => ({ useKeyStore: { getState: () => h.key } }));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: { getState: () => ({ teams: [] }) } }));

import { teamIdOwningSecret, teamObjectSecretKeys } from "./teamSecretOwnership";

beforeEach(() => {
  h.conn = { connections: [], teamConnections: {} };
  h.ident = { identities: [], teamIdentities: {} };
  h.key = { keys: [], teamKeys: {} };
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
