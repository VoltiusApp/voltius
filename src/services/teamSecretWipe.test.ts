import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  deleted: [] as string[],
  failing: new Set<string>(),
}));

vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(),
  storeSecret: vi.fn(),
  deleteSecret: vi.fn(async (k: string) => {
    if (h.failing.has(k)) throw new Error("keychain unavailable");
    h.deleted.push(k);
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { clearTeamStoresAndSecrets, drainPendingSecretWipes } from "./teamVaultSync";
import { usePendingSecretWipeStore } from "@/stores/pendingSecretWipeStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useKeyStore } from "@/stores/keyStore";
import { useTeamStore } from "@/stores/teamStore";

beforeEach(() => {
  h.deleted = [];
  h.failing = new Set();
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

test("reports the keys a partial wipe failed to delete", async () => {
  seed();
  h.failing = new Set(["password:c1", "key:k1:private"]);

  const failed = await clearTeamStoresAndSecrets("t1");

  expect([...failed].sort()).toEqual(["key:k1:private", "password:c1"]);
  expect(h.deleted).toContain("key:c1");
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

test("drain keeps the keys it still could not delete", async () => {
  usePendingSecretWipeStore.getState().enqueue("t1", ["password:c1", "key:k1:private"]);
  h.failing = new Set(["key:k1:private"]);

  await drainPendingSecretWipes();

  expect(usePendingSecretWipeStore.getState().keysByTeamId).toEqual({ t1: ["key:k1:private"] });
});

test("drain drops queued keys for a team the user has rejoined", async () => {
  // Those keychain entries have since been re-hydrated for a team the user is
  // a member of again — deleting them now would break a live vault.
  usePendingSecretWipeStore.getState().enqueue("t1", ["password:c1"]);
  useTeamStore.setState({ teams: [{ id: "t1", name: "Ops", role_ids: [] } as never] });

  await drainPendingSecretWipes();

  expect(h.deleted).toEqual([]);
  expect(usePendingSecretWipeStore.getState().keysByTeamId).toEqual({});
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
