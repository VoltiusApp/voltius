import { test, expect, vi, beforeEach } from "vitest";
import type { Connection } from "@/types";

const h = vi.hoisted(() => ({
  getSecret: vi.fn(async (_key: string) => null as string | null),
  identities: [] as { id: string; username: string; key_id?: string }[],
  connections: [] as Connection[],
  loadIdentities: vi.fn(async () => undefined),
}));

vi.mock("@/services/vault", () => ({ getSecret: h.getSecret }));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: {
    getState: () => ({ identities: h.identities, teamIdentities: {}, loadIdentities: h.loadIdentities }),
  },
}));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: { getState: () => ({ connections: h.connections, teamConnections: {} }) },
}));
vi.mock("@/services/ephemeralCredentials", () => ({
  withEphemeralCredentials: (_id: string, resolved: unknown) => resolved,
}));

import { resolveConnectionCredentials, resolveJumpHosts } from "./credentials";
import { VaultUnreadableError } from "./vaultErrors";

const conn = (over: Partial<Connection> = {}) =>
  ({ id: "c1", username: "root", host: "h", port: 22, ...over }) as Connection;

beforeEach(() => {
  h.getSecret.mockReset();
  h.getSecret.mockResolvedValue(null);
  h.identities = [];
  h.connections = [];
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

test("jump hosts still resolve when their secrets are merely absent", async () => {
  const withJump = conn({
    jump_hosts: [{ connection_id: "c-gone", host: "jh", port: 2222, username: "ju" }],
  } as Partial<Connection>);

  await expect(resolveJumpHosts(withJump)).resolves.toEqual([
    { host: "jh", port: 2222, username: "ju", password: undefined, privateKey: undefined },
  ]);
});
