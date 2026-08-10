import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHostPluginAPI } from "./runtime";
import { useVaultStore } from "@/stores/vaultStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useFolderStore } from "@/stores/folderStore";

/** The seven stores a vault's contents are counted from; all load over Tauri. */
function stubLoaders() {
  return {
    connections: vi.spyOn(useConnectionStore.getState(), "loadConnections").mockResolvedValue(),
    identities: vi.spyOn(useIdentityStore.getState(), "loadIdentities").mockResolvedValue(),
    keys: vi.spyOn(useKeyStore.getState(), "loadKeys").mockResolvedValue(),
    folders: vi.spyOn(useFolderStore.getState(), "loadFolders").mockResolvedValue(),
    snippets: vi.spyOn(useSnippetStore.getState(), "loadSnippets").mockResolvedValue(),
    snippetFolders: vi.spyOn(useSnippetFolderStore.getState(), "loadFolders").mockResolvedValue(),
    rules: vi.spyOn(usePortForwardingStore.getState(), "loadRules").mockResolvedValue(),
  };
}

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

  it("hydrates the lazily-loaded stores before deciding a vault is empty", async () => {
    // Snippets, port forwards and snippet folders are loaded by their own pages.
    // Counting them unloaded reports an empty vault and orphans what is in it.
    const loaders = stubLoaders();

    const api = createHostPluginAPI("test:hydrate", ["vaults:read", "vaults:write"]);
    const created = api.vaults.create("Lazy");
    await api.vaults.delete(created.id);

    expect(loaders.snippets).toHaveBeenCalled();
    expect(loaders.rules).toHaveBeenCalled();
    expect(loaders.snippetFolders).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("deletes an empty vault and leaves personal alone", async () => {
    stubLoaders();
    const api = createHostPluginAPI("test:delete", ["vaults:read", "vaults:write"]);
    const created = api.vaults.create("Scratch");
    await api.vaults.delete(created.id);
    expect(useVaultStore.getState().vaults.map((v) => v.id)).toEqual(["personal"]);

    await expect(api.vaults.delete("personal")).rejects.toThrow(/personal/i);
    expect(useVaultStore.getState().vaults.map((v) => v.id)).toEqual(["personal"]);
    vi.restoreAllMocks();
  });
});
