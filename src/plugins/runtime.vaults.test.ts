import { describe, it, expect, beforeEach } from "vitest";
import { createHostPluginAPI } from "./runtime";
import { useVaultStore } from "@/stores/vaultStore";

beforeEach(() => {
  useVaultStore.setState({ vaults: [{ id: "personal", name: "Personal" }], selectedVaultIds: ["personal"] });
});

describe("api.vaults permission gate", () => {
  it("list throws without vaults:read", () => {
    const api = createHostPluginAPI("test:no-read", ["vaults:write"]);
    expect(() => api.vaults.list()).toThrow(/vaults:read/);
  });

  it("create throws without vaults:write", () => {
    const api = createHostPluginAPI("test:no-write", ["vaults:read"]);
    expect(() => api.vaults.create("Nope")).toThrow(/vaults:write/);
  });

  it("delete throws without vaults:write", async () => {
    const api = createHostPluginAPI("test:no-write-2", ["vaults:read"]);
    await expect(api.vaults.delete("whatever")).rejects.toThrow(/vaults:write/);
  });

  it("the singular vault:* storage perms do not grant the plural namespace", () => {
    const api = createHostPluginAPI("test:wrong-perm", ["vault:read", "vault:write"]);
    expect(() => api.vaults.list()).toThrow(/vaults:read/);
  });
});

describe("api.vaults against the real store", () => {
  it("creates, lists and renames through the vault store", () => {
    const api = createHostPluginAPI("test:crud", ["vaults:read", "vaults:write"]);
    const created = api.vaults.create("Homelab");
    expect(created.name).toBe("Homelab");
    expect(created.team).toBe(false);

    api.vaults.rename(created.id, "Lab");
    expect(useVaultStore.getState().vaults.find((v) => v.id === created.id)!.name).toBe("Lab");
    expect(api.vaults.list().map((v) => v.name)).toEqual(["Personal", "Lab"]);
  });

  it("deletes an empty vault and leaves personal alone", async () => {
    const api = createHostPluginAPI("test:delete", ["vaults:read", "vaults:write"]);
    const created = api.vaults.create("Scratch");
    await api.vaults.delete(created.id);
    expect(useVaultStore.getState().vaults.map((v) => v.id)).toEqual(["personal"]);

    await expect(api.vaults.delete("personal")).rejects.toThrow(/personal/i);
    expect(useVaultStore.getState().vaults.map((v) => v.id)).toEqual(["personal"]);
  });
});
