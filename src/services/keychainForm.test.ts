import { describe, test, expect, vi, beforeEach } from "vitest";
import type { SshKey } from "@/types";

const h = vi.hoisted(() => ({
  storeSecret: vi.fn(),
  deleteSecret: vi.fn(async () => {}),
  saveKey: vi.fn(async () => ({ id: "new", vault_id: "personal" })),
  updateKey: vi.fn(),
  updateIdentity: vi.fn(),
  saveIdentity: vi.fn(),
  calls: [] as string[],
  moveWithSecrets: vi.fn(),
  realMove: null as unknown as (...a: never[]) => Promise<void>,
  getSecret: vi.fn(),
}));
const { storeSecret, deleteSecret, saveKey, updateKey } = h;

vi.mock("@/services/vault", () => ({ storeSecret: h.storeSecret, deleteSecret: h.deleteSecret, getSecret: h.getSecret }));
vi.mock("@/stores/keyStore", () => ({ useKeyStore: { getState: () => ({ saveKey: h.saveKey, updateKey: h.updateKey }) } }));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: { getState: () => ({ updateIdentity: h.updateIdentity, saveIdentity: h.saveIdentity }) },
}));
vi.mock("@/services/vaultObjectSecrets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/vaultObjectSecrets")>();
  h.realMove = actual.moveWithSecrets;
  return { ...actual, moveWithSecrets: h.moveWithSecrets };
});

import { saveKeyFromForm, saveIdentityFromForm, unlinkIdentityFromHost } from "./keychainForm";
import { TeamSecretUploadError } from "@/services/secretRouting";
import type { Identity } from "@/types";

const existing = { id: "k1", vault_id: "personal" } as SshKey;

beforeEach(() => {
  vi.clearAllMocks();
  h.calls.length = 0;
  h.moveWithSecrets.mockImplementation(async (...a: never[]) => {
    h.calls.push("move");
    await h.realMove(...a);
  });
  h.updateKey.mockImplementation(async () => { h.calls.push("update"); });
  h.updateIdentity.mockImplementation(async () => { h.calls.push("update"); });
  h.storeSecret.mockImplementation(async (k: string) => { h.calls.push(`store ${k}`); });
});

describe("editing hands the edited fields to the move", () => {
  test("a key passes its halves, written after a same-location update", async () => {
    await saveKeyFromForm(existing, { tags: [], vault_id: "v-other" }, null, null, "pass", "personal");
    expect(h.moveWithSecrets).toHaveBeenCalledWith("key", existing, "v-other", expect.any(Function), [
      ["key:k1:private", null], ["key:k1:public", null], ["key:k1:passphrase", "pass"],
    ]);
    expect(updateKey).toHaveBeenCalledWith("k1", { tags: [], vault_id: "v-other" });
    expect(h.calls).toEqual(["move", "update", "store key:k1:passphrase"]);
  });

  test("an identity passes its password, written after a same-location update", async () => {
    const identity = { id: "i1", vault_id: "v-other" } as Identity;
    await saveIdentityFromForm(identity, { vault_id: "personal" } as never, "pw", undefined, { current: null }, "personal");
    expect(h.moveWithSecrets).toHaveBeenCalledWith("identity", identity, "personal", expect.any(Function), [
      ["identity:i1:password", "pw"],
    ]);
    expect(h.updateIdentity).toHaveBeenCalledWith("i1", { vault_id: "personal" });
    expect(h.calls).toEqual(["move", "update", "store identity:i1:password"]);
  });
});

describe("saveKeyFromForm", () => {
  test("creates the key, then stores each half under its own secret name", async () => {
    await saveKeyFromForm(null, { tags: [] }, "PRIV", "PUB", "pass", "personal");
    expect(saveKey).toHaveBeenCalledWith({ tags: [], vault_id: "personal" });
    expect(storeSecret.mock.calls).toEqual([
      ["key:new:private", "PRIV"],
      ["key:new:public", "PUB"],
      ["key:new:passphrase", "pass"],
    ]);
    expect(deleteSecret).not.toHaveBeenCalled();
  });

  test("a null half is left untouched, an emptied one is deleted on edit", async () => {
    await saveKeyFromForm(existing, { tags: [] }, null, "", "pass", "personal");
    expect(updateKey).toHaveBeenCalledWith("k1", { tags: [] });
    expect(storeSecret.mock.calls).toEqual([["key:k1:passphrase", "pass"]]);
    expect(deleteSecret.mock.calls).toEqual([["key:k1:public"]]);
  });

  test("an empty half on create writes nothing rather than deleting", async () => {
    await saveKeyFromForm(null, { tags: [] }, "PRIV", "", "", "personal");
    expect(storeSecret.mock.calls).toEqual([["key:new:private", "PRIV"]]);
    expect(deleteSecret).not.toHaveBeenCalled();
  });
});

describe("unlinkIdentityFromHost", () => {
  const identity = { id: "i1", username: "root", key_id: "k1" } as Identity;
  const host = { id: "c1", name: "web", host: "h", port: 22, tags: [] } as never;

  test("copies the identity's credentials onto the host and survives a failed team upload", async () => {
    h.getSecret.mockImplementation(async (k: string) => (k === "identity:i1:password" ? "pw" : k === "key:k1:private" ? "pem" : null));
    h.storeSecret.mockRejectedValue(new TeamSecretUploadError("password:c1", new Error("429")));
    const updateConnection = vi.fn(async () => {});

    await expect(unlinkIdentityFromHost(identity, host, updateConnection)).resolves.toBeUndefined();

    expect(updateConnection).toHaveBeenCalledWith("c1", expect.objectContaining({ identity_id: undefined, auth_type: "key", username: "root" }));
    expect(h.storeSecret.mock.calls).toEqual([["password:c1", "pw"], ["key:c1", "pem"]]);
  });

  test("any other storage failure still reaches the caller", async () => {
    h.getSecret.mockResolvedValue("pw");
    h.storeSecret.mockRejectedValue(new Error("vault locked"));
    await expect(unlinkIdentityFromHost(identity, host, vi.fn(async () => {}))).rejects.toThrow("vault locked");
  });
});
