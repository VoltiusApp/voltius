import { test, expect, vi, beforeEach } from "vitest";
import { TeamSecretUploadError } from "@/services/secretRouting";
import type { Connection } from "@/types";
import { rulesSourceOf } from "./ruleSetIntent";

const h = vi.hoisted(() => ({
  getSecret: vi.fn(),
  storeSecret: vi.fn(),
}));
vi.mock("@/services/vault", () => ({ getSecret: h.getSecret, storeSecret: h.storeSecret }));

import { copyConnectionSecrets, duplicateFormData } from "./connectionDuplicate";

const conn = {
  id: "c1", name: "web", host: "web.example", port: 22, username: "root", tags: [], vault_id: "personal",
} as unknown as Connection;

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  h.storeSecret.mockResolvedValue(undefined);
});

test("copies the password and proxy password to the new id, and the key only when copyKey is true", async () => {
  h.getSecret.mockImplementation(async (k: string) =>
    k === "password:c1" ? "pw" : k === "proxy_password:c1" ? "proxy" : k === "key:c1" ? "key-material" : null,
  );

  await copyConnectionSecrets("c1", "c2", { copyKey: true });

  expect(h.storeSecret).toHaveBeenCalledWith("password:c2", "pw");
  expect(h.storeSecret).toHaveBeenCalledWith("proxy_password:c2", "proxy");
  expect(h.storeSecret).toHaveBeenCalledWith("key:c2", "key-material");
});

test("skips the key copy (and never even reads it) when copyKey is false", async () => {
  h.getSecret.mockImplementation(async (k: string) => (k === "password:c1" ? "pw" : null));

  await copyConnectionSecrets("c1", "c2", { copyKey: false });

  expect(h.getSecret).not.toHaveBeenCalledWith("key:c1");
  expect(h.storeSecret).not.toHaveBeenCalledWith("key:c2", expect.anything());
});

test("an inline key travels with its passphrase, and neither is read when copyKey is false", async () => {
  h.getSecret.mockImplementation(async (k: string) => (k === "key:c1" ? "key-material" : k === "passphrase:c1" ? "pp" : null));

  await copyConnectionSecrets("c1", "c2", { copyKey: true });
  expect(h.storeSecret).toHaveBeenCalledWith("passphrase:c2", "pp");

  h.getSecret.mockClear();
  await copyConnectionSecrets("c1", "c3", { copyKey: false });
  expect(h.getSecret).not.toHaveBeenCalledWith("passphrase:c1");
});

test("a secret with no value is skipped entirely: no store", async () => {
  h.getSecret.mockResolvedValue(null);

  await copyConnectionSecrets("c1", "c2", { copyKey: true });

  expect(h.storeSecret).not.toHaveBeenCalled();
});

test("each copied secret is stored exactly once, with no separate team publish", async () => {
  h.getSecret.mockImplementation(async (k: string) => {
    if (k === "password:c1") return "pw";
    if (k === "proxy_password:c1") return "proxy";
    return null;
  });

  await copyConnectionSecrets("c1", "c2", { copyKey: false });

  expect(h.storeSecret).toHaveBeenCalledTimes(2);
  expect(h.storeSecret).toHaveBeenCalledWith("password:c2", "pw");
  expect(h.storeSecret).toHaveBeenCalledWith("proxy_password:c2", "proxy");
});

test("a duplicate completes when a copied secret's team upload fails", async () => {
  h.getSecret.mockResolvedValue("pw");
  h.storeSecret.mockRejectedValue(new TeamSecretUploadError("password:new", new Error("403")));
  await expect(copyConnectionSecrets("old", "new", { copyKey: true })).resolves.toBeUndefined();
});

test("swallowFetchErrors treats a failed read as a missing secret instead of throwing", async () => {
  h.getSecret.mockImplementation(async (k: string) => {
    if (k === "password:c1") throw new Error("vault locked");
    return null;
  });

  await expect(
    copyConnectionSecrets("c1", "c2", { copyKey: true, swallowFetchErrors: true }),
  ).resolves.toBeUndefined();
  expect(h.storeSecret).not.toHaveBeenCalledWith("password:c2", expect.anything());
});

test("without swallowFetchErrors, a failed read propagates", async () => {
  h.getSecret.mockImplementation(async (k: string) => {
    if (k === "password:c1") throw new Error("vault locked");
    return null;
  });

  await expect(
    copyConnectionSecrets("c1", "c2", { copyKey: true }),
  ).rejects.toThrow("vault locked");
});

test("the duplicate form carries its source for rule copying", () => {
  const form = duplicateFormData(conn, null, { vaultId: "t1" });
  expect(rulesSourceOf(form)).toBe(conn.id);
});
