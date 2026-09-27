import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getLocalSecret: vi.fn(),
  storeLocalSecret: vi.fn(),
  deleteLocalSecret: vi.fn(),
  saveTeamVaultSecret: vi.fn(),
  resolveTeamIdForVaultId: vi.fn(),
  deleteTeamSecret: vi.fn(),
  logged: vi.fn(),
}));
vi.mock("@/services/vault", () => ({
  getLocalSecret: h.getLocalSecret,
  storeLocalSecret: h.storeLocalSecret,
  deleteLocalSecret: h.deleteLocalSecret,
}));
vi.mock("@/services/teamVaultSecrets", () => ({
  saveTeamVaultSecret: h.saveTeamVaultSecret,
  resolveTeamIdForVaultId: h.resolveTeamIdForVaultId,
}));
vi.mock("@/services/teamObjects", () => ({ deleteTeamSecret: h.deleteTeamSecret }));
vi.mock("@/lib/logger", () => ({ logFailure: () => h.logged }));

import {
  readSecretAt, writeSecretAt, removeSecretAt, keepCachedOnUploadFailure, TeamSecretUploadError,
} from "./secretRouting";
import { teamSecretCache } from "./teamSecretCache";

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  teamSecretCache.clearAll();
});

test("a team-owned key is never read from the local store, even when it has a value", async () => {
  h.getLocalSecret.mockResolvedValue("stale-local");
  await expect(readSecretAt("t1", "password:c1")).resolves.toBeNull();
  teamSecretCache.set("t1", "password:c1", "served");
  await expect(readSecretAt("t1", "password:c1")).resolves.toBe("served");
  expect(h.getLocalSecret).not.toHaveBeenCalled();
});

test("a personal key reads the local store", async () => {
  h.getLocalSecret.mockResolvedValue("pw");
  await expect(readSecretAt(null, "password:c1")).resolves.toBe("pw");
});

test("a team write caches, uploads, and never touches the local store", async () => {
  h.saveTeamVaultSecret.mockResolvedValue(undefined);
  await writeSecretAt("t1", "password:c1", "pw");
  expect(teamSecretCache.get("t1", "password:c1")).toBe("pw");
  expect(h.saveTeamVaultSecret).toHaveBeenCalledWith("t1", "password:c1", "pw");
  expect(h.storeLocalSecret).not.toHaveBeenCalled();
});

test("a failed upload throws TeamSecretUploadError and keeps the value usable this session", async () => {
  h.saveTeamVaultSecret.mockRejectedValue(Object.assign(new Error("403"), { status: 403 }));
  const err = await writeSecretAt("t1", "password:c1", "pw").catch((e) => e);
  expect(err).toBeInstanceOf(TeamSecretUploadError);
  expect(err.localKey).toBe("password:c1");
  expect(teamSecretCache.get("t1", "password:c1")).toBe("pw");
});

test("a personal write goes to the local store only", async () => {
  await writeSecretAt(null, "password:c1", "pw");
  expect(h.storeLocalSecret).toHaveBeenCalledWith("password:c1", "pw");
  expect(h.saveTeamVaultSecret).not.toHaveBeenCalled();
});

test("a team delete removes the server row, then the cached value", async () => {
  teamSecretCache.set("t1", "key:k1:private", "pem");
  h.deleteTeamSecret.mockResolvedValue(undefined);
  await removeSecretAt("t1", "key:k1:private");
  expect(h.deleteTeamSecret).toHaveBeenCalledWith("t1", "key:k1:private");
  expect(teamSecretCache.get("t1", "key:k1:private")).toBeUndefined();
  expect(h.deleteLocalSecret).not.toHaveBeenCalled();
});

test("a failed team delete keeps the cache in step with the server", async () => {
  teamSecretCache.set("t1", "password:c1", "pw");
  h.deleteTeamSecret.mockRejectedValue(new Error("500"));
  await expect(removeSecretAt("t1", "password:c1")).rejects.toThrow("500");
  expect(teamSecretCache.get("t1", "password:c1")).toBe("pw");
});

test("a personal delete goes to the local store", async () => {
  await removeSecretAt(null, "password:c1");
  expect(h.deleteLocalSecret).toHaveBeenCalledWith("password:c1");
});

test("keepCachedOnUploadFailure swallows only upload failures", () => {
  const handler = keepCachedOnUploadFailure("ctx");
  expect(() => handler(new TeamSecretUploadError("password:c1", new Error("x")))).not.toThrow();
  expect(h.logged).toHaveBeenCalled();
  expect(() => handler(new Error("vault locked"))).toThrow("vault locked");
});
