import { test, expect, vi, beforeEach } from "vitest";
import { bytesToBase64 } from "@/services/teamVaultSyncCore";
import { teamSecretCache } from "./teamSecretCache";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  getTeamVaultKey: vi.fn(),
  getCachedTeamKeyVersion: vi.fn(),
  getTeamVaultKeyAtVersion: vi.fn(),
  listTeamSecrets: vi.fn(),
  upsertTeamSecret: vi.fn(),
  resolveTeamIdFromCollections: vi.fn(),
  teams: [] as unknown[],
  vaults: [] as unknown[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/teamVaultSync", () => ({
  getTeamVaultKey: h.getTeamVaultKey,
  getCachedTeamKeyVersion: h.getCachedTeamKeyVersion,
  getTeamVaultKeyAtVersion: h.getTeamVaultKeyAtVersion,
}));
vi.mock("@/services/teamObjects", () => ({
  listTeamSecrets: h.listTeamSecrets,
  upsertTeamSecret: h.upsertTeamSecret,
}));
vi.mock("@/services/resolveTeamId", () => ({ resolveTeamIdFromCollections: h.resolveTeamIdFromCollections }));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: { getState: () => ({ teams: h.teams }) } }));
vi.mock("@/stores/vaultStore", () => ({ useVaultStore: { getState: () => ({ vaults: h.vaults }) } }));

import {
  saveTeamVaultSecret,
  resolveTeamIdForVaultId,
  hydrateTeamVaultSecrets,
} from "./teamVaultSecrets";

beforeEach(() => {
  Object.values(h).forEach((m) => (m as { mockReset?: () => void }).mockReset?.());
  h.teams = [];
  h.vaults = [];
  h.getTeamVaultKey.mockResolvedValue("ENCKEY");
  h.getCachedTeamKeyVersion.mockReturnValue(1);
  h.getTeamVaultKeyAtVersion.mockResolvedValue("OLD-ENCKEY");
  teamSecretCache.clearAll();
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
    key_version: 1,
  });
});

test("saveTeamVaultSecret is a no-op for an unrecognized local key (no key fetch, no encrypt, no upsert)", async () => {
  await saveTeamVaultSecret("t1", "totally-unknown-shape", "v");

  expect(h.getTeamVaultKey).not.toHaveBeenCalled();
  expect(h.invoke).not.toHaveBeenCalled();
  expect(h.upsertTeamSecret).not.toHaveBeenCalled();
});

// ─── resolveTeamIdForVaultId ──────────────────────────────────────────────────

test("resolveTeamIdForVaultId delegates to resolveTeamIdFromCollections with the live store snapshots", () => {
  h.teams = [{ id: "t1" }];
  h.vaults = [{ id: "v1" }];
  h.resolveTeamIdFromCollections.mockReturnValue("t1");

  expect(resolveTeamIdForVaultId("v1")).toBe("t1");
  expect(h.resolveTeamIdFromCollections).toHaveBeenCalledWith("v1", h.teams, h.vaults);
});

// ─── hydrateTeamVaultSecrets ─────────────────────────────────────────────────

const row = (object_id: string, secret_type: string, key_version = 1) => ({
  secret_id: `${secret_type}:${object_id}`, object_id, secret_type, ciphertext: bytesToBase64(new Uint8Array([1])), key_version,
});

function decryptTo(values: Record<string, string>) {
  h.invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "backup_decrypt") return { files: {}, secrets: values };
    return undefined;
  });
}

test("hydrate replaces the team's cache with exactly what the server served", async () => {
  teamSecretCache.set("t1", "password:revoked", "old");
  h.listTeamSecrets.mockResolvedValue([row("c1", "connection_password")]);
  decryptTo({ "password:c1": "pw" });

  await hydrateTeamVaultSecrets("t1");

  expect(teamSecretCache.entries("t1")).toEqual(new Map([["password:c1", "pw"]]));
});

test("a served row that fails to decrypt keeps its previous value", async () => {
  teamSecretCache.set("t1", "password:c1", "previous");
  h.listTeamSecrets.mockResolvedValue([row("c1", "connection_password", 2)]);
  h.getCachedTeamKeyVersion.mockReturnValue(3);
  h.getTeamVaultKeyAtVersion.mockRejectedValue(Object.assign(new Error("429"), { status: 429 }));

  await hydrateTeamVaultSecrets("t1");

  expect(teamSecretCache.get("t1", "password:c1")).toBe("previous");
});

test("a successfully decrypted payload lacking the expected key keeps the previous value and adds nothing new", async () => {
  teamSecretCache.set("t1", "password:c1", "previous");
  h.listTeamSecrets.mockResolvedValue([row("c1", "connection_password"), row("c2", "connection_password")]);
  decryptTo({});

  await hydrateTeamVaultSecrets("t1");

  expect(teamSecretCache.get("t1", "password:c1")).toBe("previous");
  expect(teamSecretCache.get("t1", "password:c2")).toBeUndefined();
});

test("a denial clears the team's cache and rethrows", async () => {
  teamSecretCache.set("t1", "password:c1", "pw");
  teamSecretCache.set("t2", "password:c2", "other");
  h.listTeamSecrets.mockRejectedValue(Object.assign(new Error("403"), { status: 403 }));

  await expect(hydrateTeamVaultSecrets("t1")).rejects.toMatchObject({ status: 403 });

  expect(teamSecretCache.get("t1", "password:c1")).toBeUndefined();
  expect(teamSecretCache.get("t2", "password:c2")).toBe("other");
});

test("a transient failure keeps the last served set", async () => {
  teamSecretCache.set("t1", "password:c1", "pw");
  h.getTeamVaultKey.mockRejectedValue("offline");

  await expect(hydrateTeamVaultSecrets("t1")).rejects.toBe("offline");

  expect(teamSecretCache.get("t1", "password:c1")).toBe("pw");
});

// I-F: a rejected record must leave a trace instead of vanishing silently —
// the only prior signal was "some connections disappeared," nothing in the logs.
test("hydrateTeamVaultSecrets logs a rejected record, naming the team and secret (I-F)", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  h.listTeamSecrets.mockResolvedValue([
    { secret_id: "s-poisoned", object_id: "bad", secret_type: "connection_password", ciphertext: bytesToBase64([1]), key_version: 1 },
  ]);
  h.invoke.mockRejectedValue(new Error("decrypt failed"));

  await hydrateTeamVaultSecrets("t-log");

  expect(console.warn).toHaveBeenCalled();
  const logged = vi.mocked(console.warn).mock.calls.flat().join(" ");
  expect(logged).toContain("t-log");
  expect(logged).toContain("s-poisoned");

  vi.restoreAllMocks();
});

test("saveTeamVaultSecret includes the current cached key_version", async () => {
  h.getCachedTeamKeyVersion.mockReturnValue(3);
  h.invoke.mockResolvedValue([1, 2, 3]);

  await saveTeamVaultSecret("t1", "password:c1", "hunter2");

  expect(h.upsertTeamSecret).toHaveBeenCalledWith("t1", expect.objectContaining({ key_version: 3 }));
});

test("hydrateTeamVaultSecrets uses the historical key for a record behind the current epoch", async () => {
  h.getCachedTeamKeyVersion.mockReturnValue(3);
  h.listTeamSecrets.mockResolvedValue([
    { secret_id: "s1", object_id: "c1", secret_type: "connection_password", ciphertext: "AQID", key_version: 1 },
  ]);
  h.invoke.mockResolvedValue({ secrets: { "password:c1": "hunter2" } });

  await hydrateTeamVaultSecrets("t1");

  expect(h.getTeamVaultKeyAtVersion).toHaveBeenCalledWith("t1", 1);
  expect(h.invoke).toHaveBeenCalledWith("backup_decrypt", expect.objectContaining({ encKey: "OLD-ENCKEY" }));
});

test("hydrateTeamVaultSecrets uses the plain current key for a record already on the current epoch", async () => {
  h.getCachedTeamKeyVersion.mockReturnValue(1);
  h.listTeamSecrets.mockResolvedValue([
    { secret_id: "s1", object_id: "c1", secret_type: "connection_password", ciphertext: "AQID", key_version: 1 },
  ]);
  h.invoke.mockResolvedValue({ secrets: { "password:c1": "hunter2" } });

  await hydrateTeamVaultSecrets("t1");

  expect(h.getTeamVaultKeyAtVersion).not.toHaveBeenCalled();
  expect(h.invoke).toHaveBeenCalledWith("backup_decrypt", expect.objectContaining({ encKey: "ENCKEY" }));
});

test("hydrateTeamVaultSecrets treats a missing key_version as epoch 1, not a literal undefined fetch", async () => {
  h.getCachedTeamKeyVersion.mockReturnValue(3);
  h.listTeamSecrets.mockResolvedValue([
    // A pre-#217 record with no key_version at all.
    { secret_id: "s1", object_id: "c1", secret_type: "connection_password", ciphertext: "AQID" },
  ]);
  h.invoke.mockResolvedValue({ secrets: { "password:c1": "hunter2" } });

  await hydrateTeamVaultSecrets("t1");

  expect(h.getTeamVaultKeyAtVersion).toHaveBeenCalledWith("t1", 1);
});
