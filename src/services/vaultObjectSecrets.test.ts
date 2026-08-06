import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getSecret: vi.fn(),
  save: vi.fn(),
  del: vi.fn(),
  addToast: vi.fn(),
}));
vi.mock("@/services/vault", () => ({ getSecret: h.getSecret }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: { getState: () => ({ addToast: h.addToast }) },
}));
vi.mock("@/services/teamVaultSecrets", () => ({
  saveTeamVaultSecretForVault: h.save,
  deleteTeamVaultSecretForVault: h.del,
}));

import {
  publishConnectionSecrets,
  unpublishConnectionSecrets,
  publishKeySecrets,
  unpublishKeySecrets,
  publishIdentitySecrets,
  unpublishIdentitySecrets,
  withdrawOrWarn,
} from "./vaultObjectSecrets";

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
  h.getSecret.mockResolvedValue(null);
  h.save.mockResolvedValue(undefined);
  h.del.mockResolvedValue(undefined);
});

const keysOf = (calls: unknown[][]) => calls.map((c) => c[1]);

test("publish covers every local key an object owns, and skips the ones with no value", async () => {
  h.getSecret.mockImplementation(async (k: string) => (k === "password:c1" ? "pw" : null));
  await publishConnectionSecrets("c1", "v1");
  expect(h.save.mock.calls).toEqual([["v1", "password:c1", "pw"]]);
  // A connection owns the passphrase for its inline key too; leaving it out
  // hands a member an encrypted key they cannot open.
  expect(h.getSecret.mock.calls.map((c) => c[0])).toEqual([
    "password:c1",
    "key:c1",
    "passphrase:c1",
  ]);

  h.save.mockClear();
  h.getSecret.mockResolvedValue("mat");
  await publishKeySecrets("k1", "v1");
  expect(keysOf(h.save.mock.calls)).toEqual(["key:k1:private", "key:k1:public", "key:k1:passphrase"]);

  h.save.mockClear();
  await publishIdentitySecrets("i1", "v1");
  expect(keysOf(h.save.mock.calls)).toEqual(["identity:i1:password"]);
});

// Withdrawal cannot read the value first: the point is to remove ciphertext the
// caller may no longer be able to decrypt.
test("unpublish withdraws every local key without reading it", async () => {
  await unpublishConnectionSecrets("c1", "v1");
  expect(h.del.mock.calls).toEqual([
    ["v1", "password:c1"],
    ["v1", "key:c1"],
    ["v1", "passphrase:c1"],
  ]);
  expect(h.getSecret).not.toHaveBeenCalled();

  h.del.mockClear();
  await unpublishKeySecrets("k1", "v1");
  expect(keysOf(h.del.mock.calls)).toEqual(["key:k1:private", "key:k1:public", "key:k1:passphrase"]);

  h.del.mockClear();
  await unpublishIdentitySecrets("i1", "v1");
  expect(keysOf(h.del.mock.calls)).toEqual(["identity:i1:password"]);
});

test("a failed publish is swallowed but a failed withdrawal throws", async () => {
  h.getSecret.mockResolvedValue("pw");
  h.save.mockRejectedValue(new Error("offline"));
  await expect(publishConnectionSecrets("c1", "v1")).resolves.toBeUndefined();

  h.del.mockRejectedValue(new Error("offline"));
  await expect(unpublishConnectionSecrets("c1", "v1")).rejects.toThrow("offline");
});

// The object has already moved, so the transfer must not fail — but leaving the
// credential readable in the old vault has to be reported.
test("withdrawOrWarn swallows the rejection and toasts instead", async () => {
  await expect(withdrawOrWarn(Promise.reject(new Error("offline")))).resolves.toBeUndefined();
  expect(h.addToast).toHaveBeenCalledWith(
    expect.objectContaining({ message: "common.error.secretsLeftInSourceVault", severity: "error" }),
  );

  h.addToast.mockClear();
  await withdrawOrWarn(Promise.resolve());
  expect(h.addToast).not.toHaveBeenCalled();
});
