// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const deleted: string[] = [];
  const failing = new Set<string>();
  return {
    deleted,
    failing,
    deleteTeamSecret: vi.fn(),
    purge: vi.fn(async (keys: string[]) => {
      if (failing.size > 0) throw new Error("keychain unavailable");
      deleted.push(...keys);
      return keys;
    }),
    getLocalSecret: vi.fn(async (_key: string) => null as string | null),
    writeSecretAt: vi.fn(async () => {}),
  };
});

vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(),
  storeSecret: vi.fn(),
  purgeLocalSecrets: h.purge,
  getLocalSecret: h.getLocalSecret,
}));

vi.mock("@/services/teamObjects", () => ({ deleteTeamSecret: h.deleteTeamSecret }));

vi.mock("@/services/secretRouting", () => ({ writeSecretAt: h.writeSecretAt }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => null) }));

import { clearTeamStoresAndSecrets, drainPendingSecretWipes, sweepLocalTeamSecrets } from "./teamVaultSync";
import { usePendingSecretWipeStore } from "@/stores/pendingSecretWipeStore";
import { usePendingTeamSecretUploadStore } from "@/stores/pendingTeamSecretUploadStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useKeyStore } from "@/stores/keyStore";
import { useTeamStore } from "@/stores/teamStore";

beforeEach(() => {
  h.deleted.length = 0;
  h.failing.clear();
  h.deleteTeamSecret.mockReset();
  h.purge.mockClear();
  h.getLocalSecret.mockReset().mockResolvedValue(null);
  h.writeSecretAt.mockReset().mockResolvedValue(undefined);
  usePendingSecretWipeStore.getState().clearAll();
  usePendingTeamSecretUploadStore.getState().clearAll();
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
  h.failing.add("locked");

  const failed = await clearTeamStoresAndSecrets("t1");

  expect([...failed].sort()).toEqual([
    "key:c1", "key:k1:passphrase", "key:k1:private", "key:k1:public",
    "knock_sequence:c1", "passphrase:c1", "password:c1", "proxy_password:c1",
  ]);
  expect(h.deleted).toEqual([]);
});

test("clearTeamStoresAndSecrets queues the keys itself when the purge rejects", async () => {
  seed();
  h.failing.add("locked");

  await clearTeamStoresAndSecrets("t1");

  expect(usePendingSecretWipeStore.getState().keysByTeamId["t1"]?.sort()).toEqual([
    "key:c1", "key:k1:passphrase", "key:k1:private", "key:k1:public",
    "knock_sequence:c1", "passphrase:c1", "password:c1", "proxy_password:c1",
  ]);
});

test("reports nothing when every delete succeeds", async () => {
  seed();

  expect(await clearTeamStoresAndSecrets("t1")).toEqual([]);
  expect(h.purge).toHaveBeenCalledTimes(1);
  expect(h.purge.mock.calls[0][0].sort()).toEqual([
    "key:c1", "key:k1:passphrase", "key:k1:private", "key:k1:public",
    "knock_sequence:c1", "passphrase:c1", "password:c1", "proxy_password:c1",
  ]);
});

test("drain retries queued keys and empties the queue on success", async () => {
  usePendingSecretWipeStore.getState().enqueue("t1", ["password:c1", "key:k1:private"]);

  await drainPendingSecretWipes();

  expect([...h.deleted].sort()).toEqual(["key:k1:private", "password:c1"]);
  expect(usePendingSecretWipeStore.getState().keysByTeamId).toEqual({});
});

test("drain keeps every key when the purge call rejects", async () => {
  usePendingSecretWipeStore.getState().enqueue("t1", ["password:c1", "key:k1:private"]);
  h.failing.add("locked");

  await drainPendingSecretWipes();

  expect(usePendingSecretWipeStore.getState().keysByTeamId).toEqual({ t1: ["password:c1", "key:k1:private"] });
});

test("drain purges queued keys even for a team the user has rejoined", async () => {
  usePendingSecretWipeStore.getState().enqueue("t1", ["password:c1"]);
  useTeamStore.setState({ teams: [{ id: "t1", name: "Ops", role_ids: [] } as never] });

  await drainPendingSecretWipes();

  expect(h.deleted).toEqual(["password:c1"]);
  expect(usePendingSecretWipeStore.getState().keysByTeamId).toEqual({});
});

test("drain keeps queued a key whose object is now a local one", async () => {
  usePendingSecretWipeStore.getState().enqueue("t1", ["password:c1", "key:k1:private"]);
  useConnectionStore.setState({ connections: [{ id: "c1", name: "web", host: "h", port: 22 } as never] });

  await drainPendingSecretWipes();

  expect(h.deleted).toEqual(["key:k1:private"]);
  expect(usePendingSecretWipeStore.getState().keysByTeamId).toEqual({ t1: ["password:c1"] });
});

test("drain keeps queued a key still waiting to upload", async () => {
  usePendingSecretWipeStore.getState().enqueue("t1", ["password:c1", "key:k1:private"]);
  usePendingTeamSecretUploadStore.getState().enqueue("t2", ["password:c1"]);

  await drainPendingSecretWipes();

  expect(h.deleted).toEqual(["key:k1:private"]);
  expect(usePendingSecretWipeStore.getState().keysByTeamId).toEqual({ t1: ["password:c1"] });
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

test("a pending upload whose retry succeeds is purged and resolved", async () => {
  seed();
  usePendingTeamSecretUploadStore.getState().enqueue("t1", ["password:c1"]);
  h.getLocalSecret.mockImplementation(async (k: string) => (k === "password:c1" ? "pw" : null));

  await sweepLocalTeamSecrets("t1");

  expect(h.writeSecretAt).toHaveBeenCalledWith("t1", "password:c1", "pw");
  expect(usePendingTeamSecretUploadStore.getState().keysByTeamId["t1"]).toBeUndefined();
  expect(h.deleted).toContain("password:c1");
});

test("a pending upload whose retry fails again is not purged and stays queued", async () => {
  seed();
  usePendingTeamSecretUploadStore.getState().enqueue("t1", ["password:c1"]);
  h.getLocalSecret.mockImplementation(async (k: string) => (k === "password:c1" ? "pw" : null));
  h.writeSecretAt.mockRejectedValue(new Error("403"));

  await sweepLocalTeamSecrets("t1");

  expect(usePendingTeamSecretUploadStore.getState().keysByTeamId["t1"]).toEqual(["password:c1"]);
  expect(h.deleted).not.toContain("password:c1");
});

test("a key stuck pending does not block the team's other secret keys from purging", async () => {
  seed();
  usePendingTeamSecretUploadStore.getState().enqueue("t1", ["password:c1"]);
  h.getLocalSecret.mockImplementation(async (k: string) => (k === "password:c1" ? "pw" : null));
  h.writeSecretAt.mockRejectedValue(new Error("403"));

  await sweepLocalTeamSecrets("t1");

  expect(h.deleted).toEqual(expect.arrayContaining([
    "key:c1", "key:k1:passphrase", "key:k1:private", "key:k1:public",
    "knock_sequence:c1", "passphrase:c1", "proxy_password:c1",
  ]));
});

test("a pending key with no local value is resolved without being uploaded", async () => {
  seed();
  usePendingTeamSecretUploadStore.getState().enqueue("t1", ["password:c1"]);
  h.getLocalSecret.mockResolvedValue(null);

  await sweepLocalTeamSecrets("t1");

  expect(h.writeSecretAt).not.toHaveBeenCalled();
  expect(usePendingTeamSecretUploadStore.getState().keysByTeamId["t1"]).toBeUndefined();
});

test("a pending key whose object left the team is resolved without being read, uploaded, or purged", async () => {
  usePendingTeamSecretUploadStore.getState().enqueue("t1", ["password:c1"]);
  h.getLocalSecret.mockImplementation(async (k: string) => (k === "password:c1" ? "pw" : null));

  await sweepLocalTeamSecrets("t1");

  expect(h.getLocalSecret).not.toHaveBeenCalledWith("password:c1");
  expect(h.writeSecretAt).not.toHaveBeenCalled();
  expect(h.deleted).not.toContain("password:c1");
  expect(usePendingTeamSecretUploadStore.getState().keysByTeamId["t1"]).toBeUndefined();
});

test("a pending key whose local read throws stays queued and is excluded from this sweep's purge", async () => {
  seed();
  usePendingTeamSecretUploadStore.getState().enqueue("t1", ["password:c1"]);
  h.getLocalSecret.mockImplementation(async (k: string) => {
    if (k === "password:c1") throw new Error("vault locked");
    return null;
  });

  await sweepLocalTeamSecrets("t1");

  expect(h.writeSecretAt).not.toHaveBeenCalled();
  expect(usePendingTeamSecretUploadStore.getState().keysByTeamId["t1"]).toEqual(["password:c1"]);
  expect(h.deleted).not.toContain("password:c1");
  expect(h.deleted).toEqual(expect.arrayContaining([
    "key:c1", "key:k1:passphrase", "key:k1:private", "key:k1:public", "knock_sequence:c1", "passphrase:c1", "proxy_password:c1",
  ]));
});

test("a foreground wipe keeps pending uploads queued and never purges their local copy", async () => {
  seed();
  usePendingTeamSecretUploadStore.getState().enqueue("t1", ["password:c1"]);

  await clearTeamStoresAndSecrets("t1");

  expect(usePendingTeamSecretUploadStore.getState().keysByTeamId["t1"]).toEqual(["password:c1"]);
  expect(h.deleted).not.toContain("password:c1");
  expect(h.deleted).toContain("key:k1:private");
});
