// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { importedBundle } from "./formats";

const saveKey = vi.fn(async (d: { name: string }) => ({ id: `new-${d.name}`, name: d.name }));
vi.mock("./registry", async (orig) => ({ ...(await orig<object>()), reloadAll: vi.fn(async () => {}) }));
vi.mock("@/services/vault", () => ({ storeSecret: vi.fn(async () => {}) }));
vi.mock("@/services/publicKeyStore", () => ({ loadPublicKeys: async () => new Map([["k-old", "ssh-ed25519 AAAAOLD x"]]) }));
vi.mock("@/stores/keyStore", () => ({ useKeyStore: { getState: () => ({ keys: [{ id: "k-old", name: "id_old", vault_id: "personal" }], teamKeys: {}, saveKey, loadKeys: async () => {} }) } }));

describe("importIntoVault", () => {
  it("maps each key eid to the written or matched id", async () => {
    const { importIntoVault } = await import("./storeAccess");
    const bundle = importedBundle({ keys: [
      { _eid: "k0", name: "id_new", tags: [], private_key: "PRIV" },
      { _eid: "k1", name: "id_old", tags: [], private_key: "PRIV2", public_key: "ssh-ed25519 AAAAOLD x" },
    ] });
    const { keyIds } = await importIntoVault(bundle, "personal");
    expect(keyIds.get("k0")).toBe("new-id_new");
    expect(keyIds.get("k1")).toBe("k-old");
  });
});
