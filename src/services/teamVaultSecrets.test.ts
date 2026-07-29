import { test, expect, vi, beforeEach } from "vitest";
import { bytesToBase64 } from "@/services/teamVaultSyncCore";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  getSecret: vi.fn(),
  storeSecret: vi.fn(),
  getTeamVaultKey: vi.fn(),
  listTeamSecrets: vi.fn(),
  upsertTeamSecret: vi.fn(),
  resolveTeamIdFromCollections: vi.fn(),
  teams: [] as unknown[],
  vaults: [] as unknown[],
  teamConnections: {} as Record<string, unknown[]>,
  teamIdentities: {} as Record<string, unknown[]>,
  teamKeys: {} as Record<string, unknown[]>,
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/vault", () => ({ getSecret: h.getSecret, storeSecret: h.storeSecret }));
vi.mock("@/services/teamVaultSync", () => ({ getTeamVaultKey: h.getTeamVaultKey }));
vi.mock("@/services/teamObjects", () => ({
  listTeamSecrets: h.listTeamSecrets,
  upsertTeamSecret: h.upsertTeamSecret,
}));
vi.mock("@/services/resolveTeamId", () => ({ resolveTeamIdFromCollections: h.resolveTeamIdFromCollections }));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: { getState: () => ({ teams: h.teams }) } }));
vi.mock("@/stores/vaultStore", () => ({ useVaultStore: { getState: () => ({ vaults: h.vaults }) } }));
vi.mock("@/stores/connectionStore", () => ({
  useConnectionStore: { getState: () => ({ teamConnections: h.teamConnections }) },
}));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: { getState: () => ({ teamIdentities: h.teamIdentities }) },
}));
vi.mock("@/stores/keyStore", () => ({ useKeyStore: { getState: () => ({ teamKeys: h.teamKeys }) } }));

import {
  saveTeamVaultSecret,
  saveExistingTeamVaultSecret,
  resolveTeamIdForVaultId,
  saveTeamVaultSecretForVault,
  hydrateTeamVaultSecrets,
  backfillExistingTeamVaultSecrets,
} from "./teamVaultSecrets";

beforeEach(() => {
  Object.values(h).forEach((m) => (m as { mockReset?: () => void }).mockReset?.());
  h.teams = [];
  h.vaults = [];
  h.teamConnections = {};
  h.teamIdentities = {};
  h.teamKeys = {};
  h.getTeamVaultKey.mockResolvedValue("ENCKEY");
});

// ─── saveTeamVaultSecret ────────────────────────────────────────────────────

test("saveTeamVaultSecret encrypts a single-secret payload and upserts the parsed key parts", async () => {
  h.invoke.mockResolvedValue([1, 2, 3]);

  await saveTeamVaultSecret("t1", "password:conn-9", "hunter2");

  expect(h.getTeamVaultKey).toHaveBeenCalledWith("t1");
  expect(h.invoke).toHaveBeenCalledWith("encrypt_payload", {
    encKey: "ENCKEY",
    files: {},
    secrets: { "password:conn-9": "hunter2" },
  });
  expect(h.upsertTeamSecret).toHaveBeenCalledWith("t1", {
    secret_id: "password:conn-9",
    object_id: "conn-9",
    secret_type: "connection_password",
    ciphertext: bytesToBase64([1, 2, 3]),
  });
});

test("saveTeamVaultSecret is a no-op for an unrecognized local key (no key fetch, no encrypt, no upsert)", async () => {
  await saveTeamVaultSecret("t1", "totally-unknown-shape", "v");

  expect(h.getTeamVaultKey).not.toHaveBeenCalled();
  expect(h.invoke).not.toHaveBeenCalled();
  expect(h.upsertTeamSecret).not.toHaveBeenCalled();
});

// ─── saveExistingTeamVaultSecret ────────────────────────────────────────────

test("saveExistingTeamVaultSecret reads the local secret then re-saves it into the team vault", async () => {
  h.getSecret.mockResolvedValue("stored-value");
  h.invoke.mockResolvedValue([9]);

  await saveExistingTeamVaultSecret("t1", "password:c1");

  expect(h.getSecret).toHaveBeenCalledWith("password:c1");
  expect(h.upsertTeamSecret).toHaveBeenCalledWith(
    "t1",
    expect.objectContaining({ secret_id: "password:c1", object_id: "c1" }),
  );
});

test("saveExistingTeamVaultSecret swallows a getSecret rejection and saves nothing", async () => {
  h.getSecret.mockRejectedValue(new Error("keychain locked"));

  await expect(saveExistingTeamVaultSecret("t1", "password:c1")).resolves.toBeUndefined();
  expect(h.upsertTeamSecret).not.toHaveBeenCalled();
});

test("saveExistingTeamVaultSecret skips when the local secret is missing/empty", async () => {
  h.getSecret.mockResolvedValue("");

  await saveExistingTeamVaultSecret("t1", "password:c1");
  expect(h.upsertTeamSecret).not.toHaveBeenCalled();
});

// ─── resolveTeamIdForVaultId / saveTeamVaultSecretForVault ───────────────────

test("resolveTeamIdForVaultId delegates to resolveTeamIdFromCollections with the live store snapshots", () => {
  h.teams = [{ id: "t1" }];
  h.vaults = [{ id: "v1" }];
  h.resolveTeamIdFromCollections.mockReturnValue("t1");

  expect(resolveTeamIdForVaultId("v1")).toBe("t1");
  expect(h.resolveTeamIdFromCollections).toHaveBeenCalledWith("v1", h.teams, h.vaults);
});

test("saveTeamVaultSecretForVault saves against the resolved team id", async () => {
  h.resolveTeamIdFromCollections.mockReturnValue("t-resolved");
  h.invoke.mockResolvedValue([7]);

  await saveTeamVaultSecretForVault("v1", "password:c2", "pw");

  expect(h.upsertTeamSecret).toHaveBeenCalledWith("t-resolved", expect.objectContaining({ object_id: "c2" }));
});

test("saveTeamVaultSecretForVault is a no-op when the vault resolves to no team", async () => {
  h.resolveTeamIdFromCollections.mockReturnValue(null);

  await saveTeamVaultSecretForVault("v1", "password:c2", "pw");

  expect(h.getTeamVaultKey).not.toHaveBeenCalled();
  expect(h.upsertTeamSecret).not.toHaveBeenCalled();
});

// ─── hydrateTeamVaultSecrets ─────────────────────────────────────────────────

test("hydrateTeamVaultSecrets decrypts each record and stores the recovered local secret", async () => {
  h.listTeamSecrets.mockResolvedValue([
    { object_id: "c1", secret_type: "connection_password", ciphertext: bytesToBase64([1]) },
  ]);
  h.invoke.mockResolvedValue({ files: {}, secrets: { "password:c1": "recovered" } });

  await hydrateTeamVaultSecrets("t1");

  expect(h.invoke).toHaveBeenCalledWith("backup_decrypt", { encKey: "ENCKEY", blob: [1] });
  expect(h.storeSecret).toHaveBeenCalledWith("password:c1", "recovered");
});

test("hydrateTeamVaultSecrets skips records whose secret_type has no local-key mapping", async () => {
  h.listTeamSecrets.mockResolvedValue([
    { object_id: "c1", secret_type: "bogus_type", ciphertext: bytesToBase64([1]) },
  ]);

  await hydrateTeamVaultSecrets("t1");

  expect(h.invoke).not.toHaveBeenCalled();
  expect(h.storeSecret).not.toHaveBeenCalled();
});

test("hydrateTeamVaultSecrets isolates a failing record (allSettled) so siblings still hydrate", async () => {
  h.listTeamSecrets.mockResolvedValue([
    { object_id: "bad", secret_type: "connection_password", ciphertext: bytesToBase64([1]) },
    { object_id: "good", secret_type: "connection_password", ciphertext: bytesToBase64([2]) },
  ]);
  h.invoke.mockImplementation(async (_cmd: string, args: { blob: number[] }) => {
    if (args.blob[0] === 1) throw new Error("decrypt failed");
    return { files: {}, secrets: { "password:good": "ok" } };
  });

  await expect(hydrateTeamVaultSecrets("t1")).resolves.toBeUndefined();
  expect(h.storeSecret).toHaveBeenCalledTimes(1);
  expect(h.storeSecret).toHaveBeenCalledWith("password:good", "ok");
});

test("hydrateTeamVaultSecrets does not store when the decrypted payload lacks the expected key", async () => {
  h.listTeamSecrets.mockResolvedValue([
    { object_id: "c1", secret_type: "connection_password", ciphertext: bytesToBase64([1]) },
  ]);
  h.invoke.mockResolvedValue({ files: {}, secrets: {} });

  await hydrateTeamVaultSecrets("t1");
  expect(h.storeSecret).not.toHaveBeenCalled();
});

// ─── backfillExistingTeamVaultSecrets ────────────────────────────────────────

test("backfillExistingTeamVaultSecrets fans out over connections, identities, and keys with the expected local-key shapes", async () => {
  h.teamConnections = { t1: [{ id: "conn1" }] };
  h.teamIdentities = { t1: [{ id: "id1" }] };
  h.teamKeys = { t1: [{ id: "key1" }] };
  h.getSecret.mockResolvedValue(null); // short-circuit each saveExisting after the read

  await backfillExistingTeamVaultSecrets("t1");

  const requested = h.getSecret.mock.calls.map((c) => c[0]).sort();
  expect(requested).toEqual(
    [
      "password:conn1",
      "key:conn1",
      "passphrase:conn1",
      "identity:id1:password",
      "key:key1:private",
      "key:key1:public",
      "key:key1:passphrase",
    ].sort(),
  );
});

test("backfillExistingTeamVaultSecrets handles an empty team (no per-team collections) without error", async () => {
  await expect(backfillExistingTeamVaultSecrets("t-empty")).resolves.toBeUndefined();
  expect(h.getSecret).not.toHaveBeenCalled();
});
