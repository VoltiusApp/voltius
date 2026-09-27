import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), remove: vi.fn(), teamOf: vi.fn(), addToast: vi.fn(), logged: vi.fn(),
}));
vi.mock("@/services/secretRouting", () => ({
  readSecretAt: h.read, writeSecretAt: h.write, removeSecretAt: h.remove, teamIdOfVault: h.teamOf,
}));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/lib/logger", () => ({ logFailure: () => h.logged }));
vi.mock("@/stores/notificationStore", () => ({
  useNotificationStore: { getState: () => ({ addToast: h.addToast }) },
}));

import { transferConnectionSecrets, transferKeySecrets, transferIdentitySecrets } from "./vaultObjectSecrets";

beforeEach(() => {
  Object.values(h).forEach((m) => m.mockReset());
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

test("a failed write keeps the source copy and does not throw", async () => {
  h.read.mockResolvedValue("pw");
  h.write.mockRejectedValue(new Error("403"));
  await expect(transferIdentitySecrets("i1", "personal", "team1")).resolves.toBeUndefined();
  expect(h.remove).not.toHaveBeenCalled();
  expect(h.logged).toHaveBeenCalled();
});

test("a failed withdrawal is reported, not thrown", async () => {
  h.read.mockResolvedValue("pw");
  h.remove.mockRejectedValue(new Error("500"));
  await expect(transferIdentitySecrets("i1", "team1", "team2")).resolves.toBeUndefined();
  expect(h.addToast).toHaveBeenCalledWith(expect.objectContaining({ severity: "error" }));
});
