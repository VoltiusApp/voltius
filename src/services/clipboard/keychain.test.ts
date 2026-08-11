import { describe, expect, it, vi } from "vitest";
import { keychainClipboardHalf, type KeychainClipboardDeps } from "./keychain";
import type { Identity, SshKey } from "@/types";

vi.mock("@/services/vaultSecrets", () => ({
  transferKeySecrets: vi.fn(async () => {}),
  transferIdentitySecrets: vi.fn(async () => {}),
}));

const key = (over: Partial<SshKey> = {}): SshKey =>
  ({ id: "k1", name: "key", vault_id: "personal", folder_id: null, key_type: "ed25519", tags: [], ...over }) as SshKey;
const identity = (over: Partial<Identity> = {}): Identity =>
  ({ id: "i1", name: "id", username: "root", key_id: "k1", vault_id: "personal", folder_id: null, tags: [], ...over }) as Identity;

const deps = (over: Partial<KeychainClipboardDeps> = {}): KeychainClipboardDeps => ({
  keys: [key()],
  identities: [identity()],
  keysInFolderTree: () => [],
  identitiesInFolderTree: () => [],
  vaultForFolder: () => "personal",
  updateKey: vi.fn(async () => {}),
  updateIdentity: vi.fn(async () => {}),
  moveObjectsToFolder: vi.fn(async () => {}),
  loadKeys: vi.fn(async () => {}),
  loadIdentities: vi.fn(async () => {}),
  duplicateKeyInto: vi.fn(async () => ({ id: "k-copy" })),
  duplicateIdentityInto: vi.fn(async () => ({ id: "i-copy" })),
  deleteKey: vi.fn(async () => {}),
  deleteIdentity: vi.fn(async () => {}),
  ...over,
});

describe("keychainClipboardHalf", () => {
  it("reports the key an identity would leave behind as dangling", () => {
    const half = keychainClipboardHalf(deps());
    expect(half.danglingKinds!([{ id: "i1", kind: "identity" }], [], "team-1")).toEqual(["key"]);
  });

  it("does not report a key travelling in the same paste", () => {
    const half = keychainClipboardHalf(deps());
    const items = [{ id: "i1", kind: "identity" as const }, { id: "k1", kind: "key" as const }];
    expect(half.danglingKinds!(items, [], "team-1")).toEqual([]);
  });

  it("reparents a same-vault move and reloads only the store it touched", async () => {
    const d = deps();
    await keychainClipboardHalf(d).moveItems(["k1"], "f2", "personal");
    expect(d.moveObjectsToFolder).toHaveBeenCalledWith(["k1"], "key", "f2");
    expect(d.loadKeys).toHaveBeenCalled();
    expect(d.loadIdentities).not.toHaveBeenCalled();
    expect(d.updateKey).not.toHaveBeenCalled();
  });

  it("changes vault through updateKey on a cross-vault move", async () => {
    const d = deps();
    await keychainClipboardHalf(d).moveItems(["k1"], "f2", "team-1");
    expect(d.updateKey).toHaveBeenCalledWith(
      "k1", expect.objectContaining({ folder_id: "f2", vault_id: "team-1" }),
    );
    expect(d.moveObjectsToFolder).not.toHaveBeenCalled();
  });

  it("points a duplicated identity at the duplicated key", async () => {
    const d = deps();
    const created = await keychainClipboardHalf(d).duplicateItems(["k1", "i1"], null);
    expect(created).toEqual(["k-copy", "i-copy"]);
    expect(d.duplicateIdentityInto).toHaveBeenCalledWith(
      expect.objectContaining({ id: "i1" }), null, expect.objectContaining({ keyId: "k-copy" }),
    );
  });

  it("deletes each id through the store method for its kind", async () => {
    const d = deps();
    await keychainClipboardHalf(d).deleteItems(["k1", "i1"]);
    expect(d.deleteKey).toHaveBeenCalledWith("k1");
    expect(d.deleteIdentity).toHaveBeenCalledWith("i1");
  });
});
