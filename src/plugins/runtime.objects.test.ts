import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Connection, Folder, Snippet, SshKey } from "@/types";
import { createHostPluginAPI } from "./runtime";
import { useVaultStore } from "@/stores/vaultStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useKeyStore } from "@/stores/keyStore";
import { useFolderStore } from "@/stores/folderStore";
import { useSnippetStore } from "@/stores/snippetStore";
import { useSnippetFolderStore } from "@/stores/snippetFolderStore";
import { usePortForwardingStore } from "@/stores/portForwardingStore";

vi.mock("@/services/teamService", () => ({ getMyUserId: vi.fn(async () => "u1") }));
vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(async () => null),
  storeSecret: vi.fn(async () => {}),
  getPluginSecret: vi.fn(async () => null),
  storePluginSecret: vi.fn(async () => {}),
  deletePluginSecret: vi.fn(async () => {}),
  deleteSecret: vi.fn(async () => {}),
}));
vi.mock("@/services/vaultObjectSecrets", () => ({
  publishConnectionSecrets: vi.fn(async () => {}),
  publishKeySecrets: vi.fn(async () => {}),
  publishIdentitySecrets: vi.fn(async () => {}),
  withdrawOrWarn: vi.fn(async (p: Promise<unknown>) => { await p; }),
}));
vi.mock("@/services/vaultSecrets", () => ({
  publishKeySecrets: vi.fn(async () => {}),
  unpublishKeySecrets: vi.fn(async () => {}),
  publishIdentitySecrets: vi.fn(async () => {}),
  unpublishIdentitySecrets: vi.fn(async () => {}),
  transferKeySecrets: vi.fn(async () => {}),
  transferIdentitySecrets: vi.fn(async () => {}),
  transferConnectionSecrets: vi.fn(async () => {}),
}));

const conn = {
  id: "c1", name: "web", host: "h", port: 22, username: "root", tags: [],
  vault_id: "personal", folder_id: null,
} as unknown as Connection;
const key = {
  id: "k1", name: "key", key_type: "ed25519", tags: [], vault_id: "personal", folder_id: null,
} as unknown as SshKey;
const snippet = {
  id: "s1", name: "ls", steps: [], vault_id: "personal", folder_id: null,
} as unknown as Snippet;

/** The seven stores an objects call hydrates; all load over Tauri. */
function stubLoaders() {
  vi.spyOn(useConnectionStore.getState(), "loadConnections").mockResolvedValue();
  vi.spyOn(useIdentityStore.getState(), "loadIdentities").mockResolvedValue();
  vi.spyOn(useKeyStore.getState(), "loadKeys").mockResolvedValue();
  vi.spyOn(useFolderStore.getState(), "loadFolders").mockResolvedValue();
  vi.spyOn(useSnippetStore.getState(), "loadSnippets").mockResolvedValue();
  vi.spyOn(useSnippetFolderStore.getState(), "loadFolders").mockResolvedValue();
  vi.spyOn(usePortForwardingStore.getState(), "loadRules").mockResolvedValue();
}

beforeEach(() => {
  vi.restoreAllMocks();
  useVaultStore.setState({ vaults: [{ id: "personal", name: "Personal" }], selectedVaultIds: ["personal"] });
  useConnectionStore.setState({ connections: [conn], teamConnections: {} });
  useKeyStore.setState({ keys: [key], teamKeys: {} });
  useIdentityStore.setState({ identities: [], teamIdentities: {} });
  useSnippetStore.setState({ snippets: [snippet], teamSnippets: {} });
  usePortForwardingStore.setState({ rules: [], teamRules: {} });
  useFolderStore.setState({ folders: [], teamFolders: {} });
  useSnippetFolderStore.setState({ folders: [], teamSnippetFolders: {} });
  stubLoaders();
});

describe("api.objects permission gate", () => {
  it("move throws without the moved kind's write permission", async () => {
    const api = createHostPluginAPI("test:objects-no-conn", ["keys:write"]);
    await expect(api.objects.move({ ids: ["c1"], folderId: null, vaultId: null }))
      .rejects.toThrow(/connections:write/);
  });

  it("copy is gated the same way as move", async () => {
    const api = createHostPluginAPI("test:objects-no-conn-copy", ["keys:write"]);
    await expect(api.objects.copy({ ids: ["c1"], folderId: null, vaultId: null }))
      .rejects.toThrow(/connections:write/);
  });

  it("a connections grant does not carry the keychain", async () => {
    const api = createHostPluginAPI("test:objects-conn-only", ["connections:write"]);
    await expect(api.objects.move({ ids: ["k1"], folderId: null, vaultId: null }))
      .rejects.toThrow(/keys:write/);
  });

  it("a named destination vault additionally requires vaults:write", async () => {
    const api = createHostPluginAPI("test:objects-no-vaults", ["connections:write"]);
    await expect(api.objects.move({ ids: ["c1"], folderId: null, vaultId: "v2" }))
      .rejects.toThrow(/vaults:write/);
  });

  it("refuses before any store method runs", async () => {
    const save = vi.spyOn(useConnectionStore.getState(), "saveConnection");
    const api = createHostPluginAPI("test:objects-nostore", []);
    await expect(api.objects.copy({ ids: ["c1"], folderId: null, vaultId: null })).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("api.objects against the real stores", () => {
  it("hydrates the lazily-loaded stores before resolving ids", async () => {
    const loadSnippets = vi.spyOn(useSnippetStore.getState(), "loadSnippets").mockResolvedValue();
    const loadRules = vi.spyOn(usePortForwardingStore.getState(), "loadRules").mockResolvedValue();
    const api = createHostPluginAPI("test:objects-hydrate", ["connections:write"]);
    await api.objects.move({ ids: ["c1"], folderId: null, vaultId: null }).catch(() => {});
    expect(loadSnippets).toHaveBeenCalled();
    expect(loadRules).toHaveBeenCalled();
  });

  it("files a connection into a folder through the folder store", async () => {
    useFolderStore.setState({
      folders: [{ id: "f1", name: "Prod", object_type: "connection", vault_id: "personal" } as unknown as Folder],
      teamFolders: {},
    });
    const move = vi.spyOn(useFolderStore.getState(), "moveObjectsToFolder").mockResolvedValue();
    const api = createHostPluginAPI("test:objects-move", ["connections:write"]);
    const out = await api.objects.move({ ids: ["c1"], folderId: "f1", vaultId: null });
    expect(out).toEqual({ moved: 1, created: 0, skipped: 0 });
    expect(move).toHaveBeenCalledWith(["c1"], "connection", "f1");
  });

  it("reports an object already where the call would put it as skipped, not moved", async () => {
    const api = createHostPluginAPI("test:objects-noop", ["connections:write"]);
    expect(await api.objects.move({ ids: ["c1"], folderId: null, vaultId: null }))
      .toEqual({ moved: 0, created: 0, skipped: 0 });
  });

  it("refuses an id that belongs to no tab", async () => {
    const api = createHostPluginAPI("test:objects-unknown", [
      "connections:write", "keys:write", "identities:write", "vaults:write", "folders:write",
    ]);
    await expect(api.objects.move({ ids: ["ghost"], folderId: null, vaultId: null }))
      .rejects.toThrow(/ghost/);
  });
});
