import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  deleted: [] as string[],
  failing: new Set<string>(),
  deleteTeamSecret: vi.fn(),
}));

vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(),
  storeSecret: vi.fn(),
  purgeLocalSecrets: vi.fn(async (keys: string[]) => {
    if (h.failing.size > 0) throw new Error("keychain unavailable");
    h.deleted.push(...keys);
    return keys;
  }),
}));

vi.mock("@/services/teamObjects", () => ({ deleteTeamSecret: h.deleteTeamSecret }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { clearTeamStoresAndSecrets, drainPendingSecretWipes } from "./teamVaultSync";
import { usePendingSecretWipeStore } from "@/stores/pendingSecretWipeStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useKeyStore } from "@/stores/keyStore";
import { useTeamStore } from "@/stores/teamStore";

beforeEach(() => {
  h.deleted = [];
  h.failing = new Set();
  h.deleteTeamSecret.mockReset();
  usePendingSecretWipeStore.getState().clearAll();
  useConnectionStore.setState({ teamConnections: {}, connections: [] });
  useKeyStore.setState({ teamKeys: {}, keys: [] });
  useTeamStore.setState({ teams: [] });
});

function seed(): void {
  useConnectionStore.setState({
    teamConnections: { t1: [{ id: "c1", name: "web", host: "h", port: 22 } as never] },
  });
  useKeyStore.setState({ teamKeys: { t1: [{ id: "k1", name: "deploy" } as never] } });
}

test("reports every key when the purge call rejects", async () => {
  seed();
  h.failing = new Set(["locked"]);

  const failed = await clearTeamStoresAndSecrets("t1");

  expect([...failed].sort()).toEqual([
    "key:c1", "key:k1:passphrase", "key:k1:private", "key:k1:public",
    "passphrase:c1", "password:c1", "proxy_password:c1",
  ]);
  expect(h.deleted).toEqual([]);
});

test("reports nothing when every delete succeeds", async () => {
  seed();

  expect(await clearTeamStoresAndSecrets("t1")).toEqual([]);
});

test("drain retries queued keys and empties the queue on success", async () => {
  usePendingSecretWipeStore.getState().enqueue("t1", ["password:c1", "key:k1:private"]);

  await drainPendingSecretWipes();

  expect([...h.deleted].sort()).toEqual(["key:k1:private", "password:c1"]);
  expect(usePendingSecretWipeStore.getState().keysByTeamId).toEqual({});
});

test("drain keeps every key when the purge call rejects", async () => {
  usePendingSecretWipeStore.getState().enqueue("t1", ["password:c1", "key:k1:private"]);
  h.failing = new Set(["locked"]);

  await drainPendingSecretWipes();

  expect(usePendingSecretWipeStore.getState().keysByTeamId).toEqual({ t1: ["password:c1", "key:k1:private"] });
});

test("drain purges queued keys even for a team the user has rejoined", async () => {
  // After Phase 1 no team secret belongs in the local store, member or not.
  usePendingSecretWipeStore.getState().enqueue("t1", ["password:c1"]);
  useTeamStore.setState({ teams: [{ id: "t1", name: "Ops", role_ids: [] } as never] });

  await drainPendingSecretWipes();

  expect(h.deleted).toEqual(["password:c1"]);
  expect(usePendingSecretWipeStore.getState().keysByTeamId).toEqual({});
});

test("the offboarding wipe deletes secrets locally, never through the server", async () => {
  seed();

  await clearTeamStoresAndSecrets("t1");

  expect(h.deleted).toContain("password:c1");
  expect(h.deleteTeamSecret).not.toHaveBeenCalled();
});

test("never wipes a secret a local object of the same id still owns", async () => {
  // Make-private adopts a team's objects locally under their original ids, so
  // the two stores can name the same keychain entries — and those entries are
  // now the user's own (#249). Only the objects with no local twin are wiped.
  seed();
  useConnectionStore.setState({
    connections: [{ id: "c1", name: "web", host: "h", port: 22 } as never],
  });

  expect(await clearTeamStoresAndSecrets("t1")).toEqual([]);

  expect(h.deleted).not.toContain("password:c1");
  expect(h.deleted).toContain("key:k1:private");
});
