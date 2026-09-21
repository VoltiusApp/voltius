import { describe, test, expect, vi, beforeEach } from "vitest";
import type { SshKey } from "@/types";

const h = vi.hoisted(() => ({
  storeSecret: vi.fn(),
  deleteSecret: vi.fn(async () => {}),
  saveKey: vi.fn(async () => ({ id: "new", vault_id: "personal" })),
  updateKey: vi.fn(),
}));
const { storeSecret, deleteSecret, saveKey, updateKey } = h;

vi.mock("@/services/vault", () => ({ storeSecret: h.storeSecret, deleteSecret: h.deleteSecret }));
vi.mock("@/services/teamVaultSecrets", () => ({ saveTeamVaultSecretForVault: vi.fn(async () => {}) }));
vi.mock("@/stores/keyStore", () => ({ useKeyStore: { getState: () => ({ saveKey: h.saveKey, updateKey: h.updateKey }) } }));
vi.mock("@/stores/identityStore", () => ({ useIdentityStore: { getState: () => ({}) } }));

import { saveKeyFromForm } from "./keychainForm";

const existing = { id: "k1", vault_id: "personal" } as SshKey;

beforeEach(() => { vi.clearAllMocks(); });

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
