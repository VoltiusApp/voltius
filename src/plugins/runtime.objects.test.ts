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
import { useTeamStore } from "@/stores/teamStore";
import { fetchTeamData } from "@/services/teamVaultSync";

vi.mock("@/services/teamService", () => ({ getMyUserId: vi.fn(async () => "u1") }));
vi.mock("@/services/teamVaultSync", () => ({ fetchTeamData: vi.fn(async () => {}) }));
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
  vi.mocked(fetchTeamData).mockReset().mockResolvedValue();
  useTeamStore.setState({ teams: [], membersByTeam: {}, rolesByTeam: {} });
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

/** A hosts paste also writes the key and identity its cascade carries. */
const HOSTS_GRANT = ["connections:write", "keys:write", "identities:write"];

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

  it("refuses a hosts move on connections:write alone — the cascade writes keys", async () => {
    // applyCascade saves/updates the key and identity the host references and
    // copies their private material into the destination vault.
    useVaultStore.setState({
      vaults: [{ id: "personal", name: "Personal" }, { id: "v2", name: "Homelab" }],
      selectedVaultIds: ["personal"],
    });
    const update = vi.spyOn(useConnectionStore.getState(), "updateConnection").mockResolvedValue();
    const api = createHostPluginAPI("test:objects-cascade", ["connections:write"]);
    await expect(api.objects.move({
      ids: ["c1"], folderId: null, vaultId: "v2", allowCrossVault: true,
    })).rejects.toThrow(/keys:write|identities:write/);
    expect(update).not.toHaveBeenCalled();
  });

  it("a snippet asks for snippets:write, not the connections grant", async () => {
    const api = createHostPluginAPI("test:objects-snippet", ["connections:write"]);
    await expect(api.objects.move({ ids: ["s1"], folderId: null, vaultId: null }))
      .rejects.toThrow(/snippets:write/);
  });

  it("a destination vault does not pull in vaults:write", async () => {
    // Filing objects into a vault is not creating or deleting one.
    useVaultStore.setState({
      vaults: [{ id: "personal", name: "Personal" }, { id: "v2", name: "Homelab" }],
      selectedVaultIds: ["personal"],
    });
    const update = vi.spyOn(useConnectionStore.getState(), "updateConnection").mockResolvedValue();
    const api = createHostPluginAPI("test:objects-crossvault", HOSTS_GRANT);
    await expect(api.objects.move({
      ids: ["c1"], folderId: null, vaultId: "v2", allowCrossVault: true,
    })).resolves.toEqual({ moved: 1, created: 0, skipped: 0, vault_id: "v2", folder_id: null });
    expect(update).toHaveBeenCalledWith("c1", expect.objectContaining({ vault_id: "v2" }));
  });

  it("refuses before any store method runs", async () => {
    const save = vi.spyOn(useConnectionStore.getState(), "saveConnection");
    const api = createHostPluginAPI("test:objects-nostore", []);
    await expect(api.objects.copy({ ids: ["c1"], folderId: null, vaultId: null })).rejects.toThrow();
    expect(save).not.toHaveBeenCalled();
  });
});

describe("api.objects against the real stores", () => {
  it("hydrates the lazily-loaded stores once per call, not once per gate", async () => {
    // Hydration is a full store sweep plus a team-vault sync; gating outside the
    // verb and hydrating inside it too meant paying for all of it twice.
    const loadSnippets = vi.spyOn(useSnippetStore.getState(), "loadSnippets").mockResolvedValue();
    const loadRules = vi.spyOn(usePortForwardingStore.getState(), "loadRules").mockResolvedValue();
    useTeamStore.setState({ teams: [{ id: "team-1", name: "Ops", role_ids: [] }] as never });

    const api = createHostPluginAPI("test:objects-hydrate", HOSTS_GRANT);
    await api.objects.move({ ids: ["c1"], folderId: null, vaultId: null }).catch(() => {});

    expect(loadSnippets).toHaveBeenCalledTimes(1);
    expect(loadRules).toHaveBeenCalledTimes(1);
    expect(fetchTeamData).toHaveBeenCalledTimes(1);
  });

  it("files a connection into a folder through the folder store", async () => {
    useFolderStore.setState({
      folders: [{ id: "f1", name: "Prod", object_type: "connection", vault_id: "personal" } as unknown as Folder],
      teamFolders: {},
    });
    const move = vi.spyOn(useFolderStore.getState(), "moveObjectsToFolder").mockResolvedValue();
    const api = createHostPluginAPI("test:objects-move", HOSTS_GRANT);
    const out = await api.objects.move({ ids: ["c1"], folderId: "f1", vaultId: null });
    expect(out).toEqual({ moved: 1, created: 0, skipped: 0, vault_id: "personal", folder_id: "f1" });
    expect(move).toHaveBeenCalledWith(["c1"], "connection", "f1");
  });

  it("reports an object already where the call would put it as a no-op, moving nothing", async () => {
    const api = createHostPluginAPI("test:objects-noop", HOSTS_GRANT);
    expect(await api.objects.move({ ids: ["c1"], folderId: null, vaultId: null }))
      .toEqual({ moved: 0, created: 0, skipped: 0, vault_id: null, folder_id: null });
  });

  it("gates against hydrated stores, not the empty ones a fresh app starts with", async () => {
    // The stores start empty here, as they do on a cold app: without hydrating
    // before the gate every id resolves to nothing and the call demands every
    // write permission, refusing a plugin scoped to exactly the right one.
    useSnippetStore.setState({ snippets: [], teamSnippets: {} });
    vi.spyOn(useSnippetStore.getState(), "loadSnippets").mockImplementation(async () => {
      useSnippetStore.setState({ snippets: [snippet] });
    });
    const update = vi.spyOn(useSnippetStore.getState(), "updateSnippet").mockResolvedValue();
    useSnippetFolderStore.setState({
      folders: [{ id: "sf1", name: "Ops", object_type: "snippet", vault_id: "personal" } as unknown as Folder],
      teamSnippetFolders: {},
    });

    const api = createHostPluginAPI("test:objects-cold", ["snippets:write"]);
    expect(await api.objects.move({ ids: ["s1"], folderId: "sf1", vaultId: null }))
      .toEqual({ moved: 1, created: 0, skipped: 0, vault_id: "personal", folder_id: "sf1" });
    expect(update).toHaveBeenCalledWith("s1", expect.objectContaining({ folder_id: "sf1" }));
  });

  it("resolves a team-vault object in a session where no page ever opened it", async () => {
    // The team maps are filled by fetchTeamData alone, which the UI drives.
    useTeamStore.setState({ teams: [{ id: "team-1", name: "Ops", role_ids: [] }] as never });
    vi.mocked(fetchTeamData).mockImplementation(async () => {
      useConnectionStore.setState({
        teamConnections: { "team-1": [{ ...conn, id: "c-team", vault_id: "team-1" }] },
      });
    });
    const api = createHostPluginAPI("test:objects-team", HOSTS_GRANT);
    // Resolved, not "not found": the refusal it reaches is the team-vault one.
    await expect(api.objects.copy({ ids: ["c-team"], folderId: null, vaultId: null }))
      .rejects.toThrow(/team vault/);
    expect(fetchTeamData).toHaveBeenCalledWith("team-1", { background: true });
  });

  it("refuses to MOVE an object out of a team vault, leaving the record untouched", async () => {
    // A move rewrites the team's record and withdraws its secrets: the object
    // and its credentials would vanish for every teammate. api.connections
    // .update/delete refuse a team vault; this is the same ruling.
    useTeamStore.setState({ teams: [{ id: "team-1", name: "Ops", role_ids: [] }] as never });
    vi.mocked(fetchTeamData).mockImplementation(async () => {
      useConnectionStore.setState({
        teamConnections: { "team-1": [{ ...conn, id: "c-team", vault_id: "team-1" }] },
      });
    });
    const update = vi.spyOn(useConnectionStore.getState(), "updateConnection").mockResolvedValue();
    const del = vi.spyOn(useConnectionStore.getState(), "deleteConnection").mockResolvedValue();
    const api = createHostPluginAPI("test:objects-team-move", HOSTS_GRANT);
    await expect(api.objects.move({
      ids: ["c-team"], folderId: null, vaultId: "personal", allowCrossVault: true,
    })).rejects.toThrow(/team vault "Ops"/);
    expect(update).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(useConnectionStore.getState().teamConnections["team-1"][0])
      .toMatchObject({ id: "c-team", vault_id: "team-1" });
  });

  it("refuses an id that belongs to no tab", async () => {
    const api = createHostPluginAPI("test:objects-unknown", [
      "connections:write", "keys:write", "identities:write",
      "snippets:write", "port_forwarding:write", "folders:write",
    ]);
    await expect(api.objects.move({ ids: ["ghost"], folderId: null, vaultId: null }))
      .rejects.toThrow(/ghost/);
  });
});
