import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  getVaultKey: vi.fn(),
  updatePublicKey: vi.fn(),
  getMyUserId: vi.fn(),
  getUserPublicKey: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@/services/vault", () => ({ getVaultKey: h.getVaultKey }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/teamService", () => ({
  updatePublicKey: h.updatePublicKey,
  getMyUserId: h.getMyUserId,
  getUserPublicKey: h.getUserPublicKey,
}));
vi.mock("@/services/teamSharing", () => ({ freshPublicKeys: vi.fn() }));

import { publishMyPublicKey, clearKeypairCache } from "./multiplayerService";
import { useVaultKeysStore } from "@/stores/vaultKeysStore";

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  clearKeypairCache();
  useVaultKeysStore.getState().clear();
  h.getVaultKey.mockReturnValue(new Uint8Array([1]));
  h.invoke.mockResolvedValue({ public_key: "MINE", private_key: "PRIV" });
  h.updatePublicKey.mockResolvedValue(undefined);
  h.getMyUserId.mockResolvedValue("me");
  h.getUserPublicKey.mockResolvedValue(null);
});

test("publishes when the roster has no key yet", async () => {
  await expect(publishMyPublicKey()).resolves.toBe("MINE");
  expect(h.updatePublicKey).toHaveBeenCalledWith("MINE");
});

test("publishes when the roster already agrees", async () => {
  h.getUserPublicKey.mockResolvedValue({ public_key: "MINE" });
  await expect(publishMyPublicKey()).resolves.toBe("MINE");
  expect(h.updatePublicKey).toHaveBeenCalledWith("MINE");
});

// An account's identity never changes, so deriving something else means this
// device has the wrong vault key. Overwriting was observed live: the roster then
// advertises a key nobody holds and every teammate wraps to it (#228).
test("refuses to overwrite a published key it does not derive", async () => {
  h.getUserPublicKey.mockResolvedValue({ public_key: "THE-REAL-ONE" });

  await expect(publishMyPublicKey()).rejects.toThrow("common.error.identityUnproven");
  expect(h.updatePublicKey).not.toHaveBeenCalled();
  expect(useVaultKeysStore.getState().identityUnproven).toBe(true);
});

test("refuses when the session already knows its vault key is unproven", async () => {
  useVaultKeysStore.getState().markIdentityUnproven();

  await expect(publishMyPublicKey()).rejects.toThrow("common.error.identityUnproven");
  expect(h.getUserPublicKey).not.toHaveBeenCalled();
  expect(h.updatePublicKey).not.toHaveBeenCalled();
});
