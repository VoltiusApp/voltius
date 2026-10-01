import { test, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  getSecret: vi.fn(async (_k: string) => null as string | null),
  derivePublicKey: vi.fn(),
  storeSecret: vi.fn(),
}));
vi.mock("@/services/vault", () => ({ getSecret: h.getSecret, storeSecret: h.storeSecret }));
vi.mock("@/services/publicKeyStore", () => ({ derivePublicKey: h.derivePublicKey }));

import { connectionAuditMetadata, sshPublicKeyFingerprint } from "./connectionAuditMetadata";

const PUB = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGrSaGvq7gF8+ggYkHAkB5T/9DsWjY2QeMdohYMJr1bO";
const FP = "SHA256:zTHfIjBFI8i1NsVzq7rSdFIfwoTZIieX3Jm3kzd7eMI";
const isOwn = (id: string) => id === "own";

beforeEach(() => vi.clearAllMocks());

test("fingerprint matches ssh-keygen -l", async () => {
  expect(await sshPublicKeyFingerprint(`${PUB} alice@laptop`)).toBe(FP);
  expect(await sshPublicKeyFingerprint("not a key")).toBeNull();
});

test("own identity with a stored public key", async () => {
  h.getSecret.mockImplementation(async (k) => (k === "key:k1:public" ? PUB : null));
  expect(await connectionAuditMetadata({ username: "alice", privateKey: "P", identityId: "own", keyId: "k1" }, isOwn)).toEqual({
    identity_source: "own",
    key_fingerprint: FP,
  });
  expect(h.storeSecret).not.toHaveBeenCalled();
});

test("team identity carries its id; the public key is derived in memory when not stored", async () => {
  h.derivePublicKey.mockResolvedValue({ publicKey: PUB });
  expect(await connectionAuditMetadata({ username: "deploy", privateKey: "P", identityId: "shared", keyId: "k2" }, isOwn)).toEqual({
    identity_source: "team",
    identity_id: "shared",
    key_fingerprint: FP,
  });
  expect(h.storeSecret).not.toHaveBeenCalled();
});

test("a password on the host is the host source without fingerprint", async () => {
  expect(await connectionAuditMetadata({ username: "root", password: "pw" }, isOwn)).toEqual({ identity_source: "host" });
  expect(await connectionAuditMetadata(undefined, isOwn)).toBeUndefined();
});
