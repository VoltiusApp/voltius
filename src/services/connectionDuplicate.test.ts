import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getSecret: vi.fn(),
  storeSecret: vi.fn(),
  publishConnectionSecrets: vi.fn(),
  saveTeamVaultSecretForVault: vi.fn(),
}));
vi.mock("@/services/vault", () => ({ getSecret: h.getSecret, storeSecret: h.storeSecret }));
vi.mock("@/services/vaultObjectSecrets", () => ({ publishConnectionSecrets: h.publishConnectionSecrets }));
vi.mock("@/services/teamVaultSecrets", () => ({ saveTeamVaultSecretForVault: h.saveTeamVaultSecretForVault }));

import { copyConnectionSecrets } from "./connectionDuplicate";

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  h.saveTeamVaultSecretForVault.mockResolvedValue(undefined);
  h.publishConnectionSecrets.mockResolvedValue(undefined);
});

test("copies the password and proxy password to the new id, and the key only when copyKey is true", async () => {
  h.getSecret.mockImplementation(async (k: string) =>
    k === "password:c1" ? "pw" : k === "proxy_password:c1" ? "proxy" : k === "key:c1" ? "key-material" : null,
  );

  await copyConnectionSecrets("c1", "c2", "v1", { copyKey: true, publish: "direct" });

  expect(h.storeSecret).toHaveBeenCalledWith("password:c2", "pw");
  expect(h.storeSecret).toHaveBeenCalledWith("proxy_password:c2", "proxy");
  expect(h.storeSecret).toHaveBeenCalledWith("key:c2", "key-material");
});

test("skips the key copy (and never even reads it) when copyKey is false", async () => {
  h.getSecret.mockImplementation(async (k: string) => (k === "password:c1" ? "pw" : null));

  await copyConnectionSecrets("c1", "c2", "v1", { copyKey: false, publish: "direct" });

  expect(h.getSecret).not.toHaveBeenCalledWith("key:c1");
  expect(h.storeSecret).not.toHaveBeenCalledWith("key:c2", expect.anything());
});

test("an inline key travels with its passphrase, and neither is read when copyKey is false", async () => {
  h.getSecret.mockImplementation(async (k: string) => (k === "key:c1" ? "key-material" : k === "passphrase:c1" ? "pp" : null));

  await copyConnectionSecrets("c1", "c2", "v1", { copyKey: true, publish: "direct" });
  expect(h.storeSecret).toHaveBeenCalledWith("passphrase:c2", "pp");
  expect(h.saveTeamVaultSecretForVault).toHaveBeenCalledWith("v1", "passphrase:c2", "pp");

  h.getSecret.mockClear();
  await copyConnectionSecrets("c1", "c3", "v1", { copyKey: false, publish: "direct" });
  expect(h.getSecret).not.toHaveBeenCalledWith("passphrase:c1");
});

test("a secret with no value is skipped entirely: no store, no team save", async () => {
  h.getSecret.mockResolvedValue(null);

  await copyConnectionSecrets("c1", "c2", "v1", { copyKey: true, publish: "direct" });

  expect(h.storeSecret).not.toHaveBeenCalled();
  expect(h.saveTeamVaultSecretForVault).not.toHaveBeenCalled();
});

test("direct mode publishes each copied secret to the team vault individually, swallowing a failure on one", async () => {
  h.getSecret.mockImplementation(async (k: string) => {
    if (k === "password:c1") return "pw";
    if (k === "proxy_password:c1") return "proxy";
    return null;
  });
  h.saveTeamVaultSecretForVault.mockImplementation(async (_vaultId: string, key: string) => {
    if (key === "password:c2") throw new Error("offline");
  });

  await expect(
    copyConnectionSecrets("c1", "c2", "v1", { copyKey: false, publish: "direct" }),
  ).resolves.toBeUndefined();

  expect(h.saveTeamVaultSecretForVault).toHaveBeenCalledWith("v1", "password:c2", "pw");
  expect(h.saveTeamVaultSecretForVault).toHaveBeenCalledWith("v1", "proxy_password:c2", "proxy");
  expect(h.publishConnectionSecrets).not.toHaveBeenCalled();
});

test("grouped mode stores locally and republishes once, instead of a per-secret team save", async () => {
  h.getSecret.mockImplementation(async (k: string) => (k === "password:c1" ? "pw" : null));

  await copyConnectionSecrets("c1", "c2", "v1", { copyKey: true, publish: "grouped" });

  expect(h.storeSecret).toHaveBeenCalledWith("password:c2", "pw");
  expect(h.saveTeamVaultSecretForVault).not.toHaveBeenCalled();
  expect(h.publishConnectionSecrets).toHaveBeenCalledTimes(1);
  expect(h.publishConnectionSecrets).toHaveBeenCalledWith("c2", "v1");
});

test("swallowFetchErrors treats a failed read as a missing secret instead of throwing", async () => {
  h.getSecret.mockImplementation(async (k: string) => {
    if (k === "password:c1") throw new Error("vault locked");
    return null;
  });

  await expect(
    copyConnectionSecrets("c1", "c2", "v1", { copyKey: true, publish: "grouped", swallowFetchErrors: true }),
  ).resolves.toBeUndefined();
  expect(h.storeSecret).not.toHaveBeenCalledWith("password:c2", expect.anything());
});

test("without swallowFetchErrors, a failed read propagates", async () => {
  h.getSecret.mockImplementation(async (k: string) => {
    if (k === "password:c1") throw new Error("vault locked");
    return null;
  });

  await expect(
    copyConnectionSecrets("c1", "c2", "v1", { copyKey: true, publish: "direct" }),
  ).rejects.toThrow("vault locked");
});
