import { test, expect, vi, beforeEach } from "vitest";
import type { SshKey, SshKeyFormData, Identity, IdentityFormData } from "@/types";

const h = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), remove: vi.fn(), teamOf: vi.fn(), addToast: vi.fn(), logged: vi.fn(),
  enqueue: vi.fn(), credentialsUnavailable: {} as Record<string, boolean>,
}));
vi.mock("@/services/secretRouting", () => ({
  readSecretAt: h.read, writeSecretAt: h.write, removeSecretAt: h.remove, teamIdOfVault: h.teamOf,
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/lib/logger", () => ({ logFailure: () => h.logged }));
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: { getState: () => ({ addToast: h.addToast }) },
}));
vi.mock("@/stores/teamVaultStateStore", () => ({
  useTeamVaultStateStore: { getState: () => ({ credentialsUnavailableByTeamId: h.credentialsUnavailable }) },
}));
vi.mock("@/stores/pendingTeamSecretUploadStore", () => ({
  usePendingTeamSecretUploadStore: { getState: () => ({ enqueue: h.enqueue }) },
}));

import {
  transferConnectionSecrets, transferKeySecrets, transferIdentitySecrets,
  moveKeyToVault, moveIdentityToVault,
} from "./vaultObjectSecrets";

beforeEach(() => {
  h.read.mockReset();
  h.write.mockReset();
  h.remove.mockReset();
  h.teamOf.mockReset();
  h.addToast.mockReset();
  h.logged.mockReset();
  h.enqueue.mockReset();
  h.credentialsUnavailable = {};
  h.teamOf.mockImplementation((v: string) => (v.startsWith("team") ? v : null));
  h.write.mockResolvedValue(undefined);
  h.remove.mockResolvedValue(undefined);
});

test("personal to team uploads each present secret, then deletes the local copy", async () => {
  h.read.mockImplementation(async (_t: string | null, k: string) => (k === "password:c1" ? "pw" : null));
  await transferConnectionSecrets("c1", "personal", "team1");
  expect(h.read.mock.calls.map((c) => c[1])).toEqual(["password:c1", "key:c1", "passphrase:c1", "proxy_password:c1"]);
  expect(h.write.mock.calls).toEqual([["team1", "password:c1", "pw"]]);
  expect(h.remove.mock.calls).toEqual([[null, "password:c1"]]);
});

test("team to personal writes the local store and withdraws the team row", async () => {
  h.read.mockImplementation(async (_t: string | null, k: string) => (k === "key:k1:private" ? "pem" : null));
  await transferKeySecrets("k1", "team1", "personal");
  expect(h.write.mock.calls).toEqual([[null, "key:k1:private", "pem"]]);
  expect(h.remove.mock.calls).toEqual([["team1", "key:k1:private"]]);
});

test("between two personal vaults nothing moves", async () => {
  await transferIdentitySecrets("i1", "personal", "vault-b");
  expect(h.read).not.toHaveBeenCalled();
});

test("a failed write from a personal source queues a retry and warns, without throwing", async () => {
  h.read.mockResolvedValue("pw");
  h.write.mockRejectedValue(new Error("403"));
  await expect(transferIdentitySecrets("i1", "personal", "team1")).resolves.toBeUndefined();
  expect(h.remove).not.toHaveBeenCalled();
  expect(h.logged).toHaveBeenCalled();
  expect(h.enqueue).toHaveBeenCalledWith("team1", ["identity:i1:password"]);
  expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({
    message: "common.error.secretsUploadPending", severity: "error",
  }));
});

test("a failed withdrawal is reported with the source-left message, not thrown", async () => {
  h.read.mockResolvedValue("pw");
  h.remove.mockRejectedValue(new Error("500"));
  await expect(transferIdentitySecrets("i1", "team1", "team2")).resolves.toBeUndefined();
  expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({
    message: "common.error.secretsLeftInSourceVault", severity: "error",
  }));
});

test("a fully successful transfer never toasts", async () => {
  h.read.mockResolvedValue("pw");
  await transferIdentitySecrets("i1", "personal", "team1");
  expect(h.addToast).not.toHaveBeenCalled();
});

test("a partial failure removes only the keys that were written, and queues the rest", async () => {
  h.read.mockImplementation(async (_t: string | null, k: string) => (k === "key:c1" || k === "password:c1" ? "val" : null));
  h.write.mockImplementation(async (_to: string, k: string) => {
    if (k === "key:c1") throw new Error("403");
  });
  await transferConnectionSecrets("c1", "personal", "team1");
  expect(h.remove.mock.calls).toEqual([[null, "password:c1"]]);
  expect(h.enqueue).toHaveBeenCalledWith("team1", ["key:c1"]);
});

test("a source team with unavailable credentials warns instead of blindly deleting", async () => {
  h.credentialsUnavailable = { team1: true };
  await transferKeySecrets("k1", "team1", "team2");
  expect(h.read).not.toHaveBeenCalled();
  expect(h.write).not.toHaveBeenCalled();
  expect(h.remove).not.toHaveBeenCalled();
  expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({
    message: "common.error.secretsLeftInSourceVault", severity: "error",
  }));
});

test("moveKeyToVault updates before transferring the key's secrets", async () => {
  const calls: string[] = [];
  const updateKey = vi.fn(async () => { calls.push("update"); });
  h.read.mockImplementation(async () => { calls.push("read"); return "pem"; });
  const key = { id: "k1", vault_id: "personal" } as SshKey;

  await moveKeyToVault(key, "team1", { vault_id: "team1" } as SshKeyFormData, updateKey);

  expect(calls).toEqual(["update", "read", "read", "read"]);
  expect(updateKey).toHaveBeenCalledWith("k1", { vault_id: "team1" });
  expect(h.write.mock.calls.map((c) => c[0])).toEqual(["team1", "team1", "team1"]);
});

test("moveIdentityToVault updates before transferring the identity's secret", async () => {
  const calls: string[] = [];
  const updateIdentity = vi.fn(async () => { calls.push("update"); });
  h.read.mockImplementation(async () => { calls.push("read"); return "pw"; });
  const identity = { id: "i1", vault_id: "team1" } as Identity;

  await moveIdentityToVault(identity, "personal", { vault_id: "personal" } as IdentityFormData, updateIdentity);

  expect(calls).toEqual(["update", "read"]);
  expect(updateIdentity).toHaveBeenCalledWith("i1", { vault_id: "personal" });
  expect(h.write).toHaveBeenCalledWith(null, "identity:i1:password", "pw");
});
