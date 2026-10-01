import { test, expect, vi, beforeEach } from "vitest";
import type { Connection } from "@/types";
import type { CredentialSnapshot } from "@/services/credentialScope";

const h = vi.hoisted(() => ({
  getSecret: vi.fn(async (_key: string) => null as string | null),
  identities: [] as { id: string; username: string; key_id?: string }[],
  connections: [] as Connection[],
  loadIdentities: vi.fn(async () => undefined),
  can: vi.fn((_permission: string, _vaultId: string, _objectId?: string) => true),
  snapshot: null as unknown as CredentialSnapshot,
}));

vi.mock("@/services/vault", () => ({ getSecret: h.getSecret }));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: {
    getState: () => ({ identities: h.identities, teamIdentities: {}, loadIdentities: h.loadIdentities }),
  },
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: { getState: () => ({ connections: h.connections, teamConnections: {} }) },
  findAnyConnection: (id: string) => h.connections.find((c: { id: string }) => c.id === id),
}));
vi.mock("@/services/permissionsFromStores", () => ({
  canConnect: async (vaultId: string | undefined, objectId: string) => h.can("CONNECT", vaultId ?? "", objectId),
  canFromStoresAsync: async () => (p: string, v: string, o?: string) => h.can(p, v, o),
}));
vi.mock("@/services/credentialSnapshot", () => ({ credentialSnapshotFromStores: () => h.snapshot }));
vi.mock("@/services/ephemeralCredentials", () => ({
  withEphemeralCredentials: (_id: string, resolved: unknown) => resolved,
}));

import { ConnectNotAllowedError, resolveConnectionCredentials, resolveJumpHosts } from "./credentials";
import { VaultUnreadableError } from "./vaultErrors";
import { IdentityPickUnavailableError } from "./credentialPlan";

const conn = (over: Partial<Connection> = {}) =>
  ({ id: "c1", username: "root", host: "h", port: 22, ...over }) as Connection;

beforeEach(() => {
  h.getSecret.mockReset();
  h.getSecret.mockResolvedValue(null);
  h.identities = [];
  h.connections = [];
  h.can.mockReset();
  h.can.mockReturnValue(true);
  h.snapshot = {
    teams: [], vaults: [], ownIdentities: [], teamIdentities: {}, teamKeys: {},
    picks: { byObject: {}, byTeam: {} }, teamSecret: () => undefined, secretsHydrated: () => true,
  };
});

test("a host the member may not connect to yields no credentials at all", async () => {
  h.can.mockImplementation((permission, vaultId, objectId) => !(permission === "CONNECT" && vaultId === "t1" && objectId === "c1"));
  h.getSecret.mockResolvedValue("pw");

  await expect(resolveConnectionCredentials(conn({ vault_id: "t1" }))).rejects.toThrow(ConnectNotAllowedError);
  expect(h.getSecret).not.toHaveBeenCalled();
});

test("a jump host the member may not connect to blocks the whole chain", async () => {
  h.connections = [conn({ id: "jump", vault_id: "t1" })];
  h.can.mockImplementation((permission, _vaultId, objectId) => !(permission === "CONNECT" && objectId === "jump"));

  await expect(resolveJumpHosts(conn({ jump_hosts: [{ id: "j1", connection_id: "jump" }] }))).rejects.toThrow(ConnectNotAllowedError);
});

test("a stored password is resolved", async () => {
  h.getSecret.mockImplementation(async (key) => (key === "password:c1" ? "pw" : null));
  await expect(resolveConnectionCredentials(conn())).resolves.toMatchObject({ username: "root", password: "pw" });
});

// A never-stored secret is a legitimate absence, distinct from an unreadable vault.
test("a secret that is not stored resolves to undefined, not an error", async () => {
  const creds = await resolveConnectionCredentials(conn());
  expect(creds.username).toBe("root");
  expect(creds.password).toBeUndefined();
  expect(creds.privateKey).toBeUndefined();
});

test("an unreadable vault propagates instead of resolving to no credentials", async () => {
  h.getSecret.mockRejectedValue(new VaultUnreadableError());
  await expect(resolveConnectionCredentials(conn())).rejects.toThrow(VaultUnreadableError);
});

test("an unreadable vault propagates out of jump host resolution too", async () => {
  h.identities = [{ id: "i1", username: "jump", key_id: "k1" }];
  h.getSecret.mockRejectedValue(new VaultUnreadableError());

  const withJump = conn({
    jump_hosts: [{ connection_id: "c-gone", host: "jh", port: 22, identity_id: "i1" }],
  } as Partial<Connection>);

  await expect(resolveJumpHosts(withJump)).rejects.toThrow(VaultUnreadableError);
});

test("a jump host snapshot with an identity resolves that identity's secrets", async () => {
  h.identities = [{ id: "i1", username: "jump", key_id: "k1" }];
  h.getSecret.mockImplementation(async (k) => ({ "key:k1:private": "PRIV", "key:k1:passphrase": "PASS" })[k] ?? null);
  const withJump = conn({ jump_hosts: [{ connection_id: "c-gone", host: "jh", port: 22, identity_id: "i1" }] } as Partial<Connection>);

  await expect(resolveJumpHosts(withJump)).resolves.toEqual([
    { host: "jh", port: 22, username: "jump", password: undefined, privateKey: "PRIV", passphrase: "PASS" },
  ]);
});

test("jump hosts still resolve when their secrets are merely absent", async () => {
  const withJump = conn({
    jump_hosts: [{ connection_id: "c-gone", host: "jh", port: 2222, username: "ju" }],
  } as Partial<Connection>);

  await expect(resolveJumpHosts(withJump)).resolves.toEqual([
    { host: "jh", port: 2222, username: "ju", password: undefined, privateKey: undefined },
  ]);
});

const ownIdentity = { id: "own", username: "alice", key_id: "k-own", tags: [] };

test("a pick on a team host resolves the picked identity's secrets", async () => {
  h.snapshot.teams = [{ id: "t1" }];
  h.snapshot.ownIdentities = [ownIdentity as never];
  h.snapshot.picks.byObject = { c1: "own" };
  h.getSecret.mockImplementation(async (k) => (k === "key:k-own:private" ? "PRIV" : k === "password:c1" ? "shared-pw" : null));

  const creds = await resolveConnectionCredentials(conn({ vault_id: "t1" }));

  expect(creds).toMatchObject({ username: "alice", privateKey: "PRIV", identityId: "own", keyId: "k-own" });
  expect(creds.password).toBeUndefined();
});

test("an unusable pick throws before any secret is read", async () => {
  h.snapshot.teams = [{ id: "t1" }];
  h.snapshot.picks.byObject = { c1: "gone" };

  await expect(resolveConnectionCredentials(conn({ vault_id: "t1" }))).rejects.toBeInstanceOf(IdentityPickUnavailableError);
  expect(h.getSecret).not.toHaveBeenCalled();
});

test("the vault default waits until the team's secrets have hydrated", async () => {
  h.snapshot.teams = [{ id: "t1" }];
  h.snapshot.ownIdentities = [ownIdentity as never];
  h.snapshot.picks.byTeam = { t1: "own" };
  h.snapshot.secretsHydrated = () => false;
  h.getSecret.mockImplementation(async (k) => (k === "key:k-own:private" ? "PRIV" : k === "password:c1" ? "shared-pw" : null));

  await expect(resolveConnectionCredentials(conn({ vault_id: "t1" }))).resolves.toMatchObject({ username: "root", password: "shared-pw" });
  h.snapshot.secretsHydrated = () => true;
  await expect(resolveConnectionCredentials(conn({ vault_id: "t1" }))).resolves.toMatchObject({ username: "alice", identityId: "own" });
});

test("skipPick uses the host credential once", async () => {
  h.snapshot.teams = [{ id: "t1" }];
  h.snapshot.picks.byObject = { c1: "gone" };
  h.getSecret.mockImplementation(async (k) => (k === "password:c1" ? "pw" : null));

  await expect(resolveConnectionCredentials(conn({ vault_id: "t1" }), { skipPick: true })).resolves.toMatchObject({ password: "pw" });
});

test("a jump host with an unusable pick blocks the chain and names the jump host", async () => {
  h.snapshot.teams = [{ id: "t1" }];
  h.snapshot.picks.byObject = { jump: "gone" };
  h.connections = [conn({ id: "jump", name: "bastion", vault_id: "t1" })];

  const err = await resolveJumpHosts(conn({ jump_hosts: [{ id: "j1", connection_id: "jump" }] })).catch((e) => e);
  expect(err).toBeInstanceOf(IdentityPickUnavailableError);
  expect(err.issue.connectionName).toBe("bastion");
});
