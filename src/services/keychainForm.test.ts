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
}));
const { storeSecret, deleteSecret, saveKey, updateKey } = h;

vi.mock("@/services/vault", () => ({ storeSecret: h.storeSecret, deleteSecret: h.deleteSecret }));
vi.mock("@/stores/keyStore", () => ({ useKeyStore: { getState: () => ({ saveKey: h.saveKey, updateKey: h.updateKey }) } }));
vi.mock("@/stores/identityStore", () => ({
  useIdentityStore: { getState: () => ({ updateIdentity: h.updateIdentity, saveIdentity: h.saveIdentity }) },
}));
vi.mock("@/services/vaultObjectSecrets", () => ({ moveWithSecrets: h.moveWithSecrets }));

import { saveKeyFromForm, saveIdentityFromForm } from "./keychainForm";
import type { Identity } from "@/types";

const existing = { id: "k1", vault_id: "personal" } as SshKey;

beforeEach(() => {
  vi.clearAllMocks();
  h.calls.length = 0;
  h.moveWithSecrets.mockImplementation(async (_k: string, _o: unknown, _to: unknown, update: () => Promise<unknown>) => {
    h.calls.push("move");
    await update();
  });
  h.updateKey.mockImplementation(async () => { h.calls.push("update"); });
  h.updateIdentity.mockImplementation(async () => { h.calls.push("update"); });
  h.storeSecret.mockImplementation(async (k: string) => { h.calls.push(`store ${k}`); });
});

describe("editing into another vault", () => {
  test("a key moves its secrets with it, then writes the edited halves", async () => {
    await saveKeyFromForm(existing, { tags: [], vault_id: "v-team" }, null, null, "pass", "personal");
    expect(h.moveWithSecrets).toHaveBeenCalledWith("key", existing, "v-team", expect.any(Function));
    expect(updateKey).toHaveBeenCalledWith("k1", { tags: [], vault_id: "v-team" });
    expect(h.calls).toEqual(["move", "update", "store key:k1:passphrase"]);
  });

  test("an identity moves its secret with it, then writes the edited password", async () => {
    const identity = { id: "i1", vault_id: "v-team" } as Identity;
    await saveIdentityFromForm(identity, { vault_id: "personal" } as never, "pw", undefined, { current: null }, "personal");
    expect(h.moveWithSecrets).toHaveBeenCalledWith("identity", identity, "personal", expect.any(Function));
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
