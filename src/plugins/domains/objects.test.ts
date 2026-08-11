import { describe, expect, it, vi } from "vitest";
import type { Connection, Folder, Identity, PortForwardingRule, Snippet, SshKey } from "@/types";
import { createObjectsAPI, objectPermissionsFor, type MoveInput, type ObjectPorts } from "./objects";

vi.mock("@/services/vault", () => ({
  getSecret: vi.fn(async () => "material"),
  storeSecret: vi.fn(async () => {}),
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
vi.mock("@/services/vaultObjectSecrets", () => ({
  publishConnectionSecrets: vi.fn(async () => {}),
  publishKeySecrets: vi.fn(async () => {}),
  publishIdentitySecrets: vi.fn(async () => {}),
  withdrawOrWarn: vi.fn(async (p: Promise<unknown>) => { await p; }),
}));

const conn = (over: Partial<Connection> = {}): Connection => ({
  id: "c1", name: "web", host: "h", port: 22, username: "root", tags: [],
  vault_id: "personal", folder_id: null, key_id: "k1",
  ...over,
} as Connection);
const key = (over: Partial<SshKey> = {}): SshKey => ({
  id: "k1", name: "key", key_type: "ed25519", tags: [], vault_id: "personal", folder_id: null,
  ...over,
} as SshKey);
const identity = (over: Partial<Identity> = {}): Identity => ({
  id: "i1", name: "root", username: "root", tags: [], vault_id: "personal", folder_id: null,
  ...over,
} as Identity);
const snippet = (over: Partial<Snippet> = {}): Snippet => ({
  id: "s1", name: "ls", steps: [], vault_id: "personal", folder_id: null,
  ...over,
} as Snippet);
const rule = (over: Partial<PortForwardingRule> = {}): PortForwardingRule => ({
  id: "r1", name: "tunnel", connection_ids: [], vault_id: "personal", folder_id: null,
  ...over,
} as PortForwardingRule);
const folder = (over: Partial<Folder> = {}): Folder => ({
  id: "f1", name: "Prod", object_type: "connection", vault_id: "personal", parent_folder_id: null,
  ...over,
} as Folder);

function fakePorts(over: Partial<ObjectPorts> = {}): ObjectPorts {
  return {
    hydrate: vi.fn(async () => {}),
    can: () => true,
    isTeamVault: (id: string) => id === "team-1",
    vaults: () => [
      { id: "personal", name: "Personal" },
      { id: "vault-2", name: "Homelab" },
      { id: "team-1", name: "Ops" },
    ],
    accessibleVaultIds: () => ["personal", "vault-2", "team-1"],

    connections: () => [conn()],
    keys: () => [key()],
    identities: () => [identity()],
    snippets: () => [snippet()],
    rules: () => [rule()],
    folders: () => [folder(), folder({ id: "f-team", vault_id: "team-1" })],
    snippetFolders: () => [folder({ id: "sf1", object_type: "snippet" })],

    saveConnection: vi.fn(async () => ({ id: "c-copy" })),
    updateConnection: vi.fn(async () => {}),
    deleteConnection: vi.fn(async () => {}),
    loadConnections: vi.fn(async () => {}),

    saveKey: vi.fn(async () => ({ id: "k-copy" })),
    updateKey: vi.fn(async () => {}),
    deleteKey: vi.fn(async () => {}),
    loadKeys: vi.fn(async () => {}),

    saveIdentity: vi.fn(async () => ({ id: "i-copy" })),
    updateIdentity: vi.fn(async () => {}),
    deleteIdentity: vi.fn(async () => {}),
    loadIdentities: vi.fn(async () => {}),

    createSnippet: vi.fn(async () => ({ id: "s-copy" })),
    updateSnippet: vi.fn(async () => {}),
    deleteSnippet: vi.fn(async () => {}),

    createRule: vi.fn(async () => ({ id: "r-copy" })),
    updateRule: vi.fn(async () => {}),
    deleteRule: vi.fn(async () => {}),
    moveRuleFolder: vi.fn(async () => {}),

    moveObjectsToFolder: vi.fn(async () => {}),
    saveFolder: vi.fn(async () => folder({ id: "f-new" })),
    updateFolder: vi.fn(async () => {}),
    deleteFolder: vi.fn(async () => {}),
    moveFolder: vi.fn(async () => {}),
    saveSnippetFolder: vi.fn(async () => folder({ id: "sf-new", object_type: "snippet" })),
    updateSnippetFolder: vi.fn(async () => {}),
    deleteSnippetFolder: vi.fn(async () => {}),
    moveSnippetFolder: vi.fn(async () => {}),
    ...over,
  };
}

/** `authorize` is required on the API; these tests exercise the domain, not the gate. */
function objects(ports: ObjectPorts) {
  const api = createObjectsAPI(ports);
  return {
    move: (input: MoveInput) => api.move(input, () => {}),
    copy: (input: MoveInput) => api.copy(input, () => {}),
  };
}

describe("createObjectsAPI", () => {
  it("hydrates the stores before reading them", async () => {
    const ports = fakePorts();
    await objects(ports).move({ ids: ["c1"], folderId: "f1", vaultId: null });
    expect(ports.hydrate).toHaveBeenCalled();
  });

  it("refuses ids from two tabs, naming both", async () => {
    await expect(objects(fakePorts()).move({
      ids: ["c1", "s1"], folderId: null, vaultId: null,
    })).rejects.toThrow(/hosts.*snippets|snippets.*hosts/);
  });

  it("refuses an unknown id", async () => {
    await expect(objects(fakePorts()).move({
      ids: ["nope"], folderId: null, vaultId: null,
    })).rejects.toThrow(/nope/);
  });

  it("refuses a destination folder from another tab", async () => {
    await expect(objects(fakePorts()).move({
      ids: ["c1"], folderId: "sf1", vaultId: null,
    })).rejects.toThrow(/sf1/);
  });

  it("refuses a destination folder that is in another vault than the one asked for", async () => {
    await expect(objects(fakePorts()).move({
      ids: ["c1"], folderId: "f1", vaultId: "vault-2", allowCrossVault: true,
    })).rejects.toThrow(/vault-2/);
  });

  it("refuses a cross-vault move without the flag and mutates nothing", async () => {
    const ports = fakePorts();
    await expect(objects(ports).move({
      ids: ["c1"], folderId: null, vaultId: "vault-2",
    })).rejects.toThrow(/allowCrossVault/);
    expect(ports.updateConnection).not.toHaveBeenCalled();
    expect(ports.moveObjectsToFolder).not.toHaveBeenCalled();
  });

  it("names the cascade in the cross-vault refusal", async () => {
    const ports = fakePorts();
    const err: Error = await objects(ports)
      .move({ ids: ["c1"], folderId: null, vaultId: "vault-2" })
      .then(() => { throw new Error("expected a refusal"); }, (e: Error) => e);
    expect(JSON.parse(err.message.slice(err.message.indexOf("{")))).toMatchObject({
      plan: { count: 1, targetVaultId: "vault-2", targetVaultName: "Homelab", cascade: [{ type: "key" }] },
    });
  });

  it("performs the cross-vault move when the flag is set", async () => {
    const ports = fakePorts();
    const out = await objects(ports).move({
      ids: ["c1"], folderId: null, vaultId: "vault-2", allowCrossVault: true,
    });
    expect(out.moved).toBe(1);
    expect(ports.updateConnection).toHaveBeenCalledWith(
      "c1", expect.objectContaining({ vault_id: "vault-2" }),
    );
    // The outcome names where it wrote, so a move confirms itself: no verb
    // returned an object's vault or folder, and callers had to read the app's
    // own stores to find out whether a move landed.
    expect(out).toMatchObject({ vault_id: "vault-2", folder_id: null });
  });

  it("names no destination vault when the call named none", async () => {
    const ports = fakePorts();
    const out = await objects(ports).move({ ids: ["c1"], folderId: null, vaultId: null });
    // null is not "unknown": every object kept the vault it had, so there is no
    // single id to report.
    expect(out.vault_id).toBe(null);
  });

  it("refuses a team-vault destination", async () => {
    const ports = fakePorts();
    await expect(objects(ports).move({
      ids: ["c1"], folderId: null, vaultId: "team-1", allowCrossVault: true,
    })).rejects.toThrow(/team vault/);
    expect(ports.updateConnection).not.toHaveBeenCalled();
  });

  it("reports a permission refusal as a refusal, not a success", async () => {
    const ports = fakePorts({ can: () => false });
    await expect(objects(ports).move({
      ids: ["c1"], folderId: null, vaultId: "vault-2", allowCrossVault: true,
    })).rejects.toThrow(/EDIT_CONNECTIONS|EDIT_KEYS/);
    expect(ports.updateConnection).not.toHaveBeenCalled();
  });

  it("reports a dangling reference as a refusal, not a success", async () => {
    // Port forwarding cannot cascade: a rule keeps pointing at hosts left behind.
    const ports = fakePorts({ rules: () => [rule({ connection_ids: ["c1"] })] });
    await expect(objects(ports).move({
      ids: ["r1"], folderId: null, vaultId: "vault-2", allowCrossVault: true,
    })).rejects.toThrow(/connection/);
  });

  it("refuses to copy an object out of a team vault, naming the vault", async () => {
    // A cut is gated by the user's own vault permissions on the source; a copy
    // removes nothing, so nothing checks the source and the duplicate would
    // carry the team's secrets into a personal vault.
    const ports = fakePorts({ connections: () => [conn({ id: "c-team", vault_id: "team-1" })] });
    await expect(objects(ports).copy({ ids: ["c-team"], folderId: null, vaultId: null }))
      .rejects.toThrow(/Ops/);
    expect(ports.saveConnection).not.toHaveBeenCalled();
  });

  it("refuses to move an object out of a team vault, naming the vault", async () => {
    // A move rewrites the record and withdraws the secrets: the object and its
    // credentials vanish for every teammate. Every write verb refuses a team vault.
    const ports = fakePorts({ connections: () => [conn({ id: "c-team", vault_id: "team-1" })] });
    await expect(objects(ports).move({ ids: ["c-team"], folderId: null, vaultId: null }))
      .rejects.toThrow(/Ops/);
    expect(ports.updateConnection).not.toHaveBeenCalled();
    expect(ports.deleteConnection).not.toHaveBeenCalled();
  });

  it("de-dupes repeated ids instead of acting on them twice", async () => {
    const ports = fakePorts();
    const out = await objects(ports).copy({ ids: ["c1", "c1"], folderId: "f1", vaultId: null });
    expect(out.created).toBe(1);
    expect(ports.saveConnection).toHaveBeenCalledTimes(1);
  });

  it("refuses a folder filed under itself instead of reporting a no-op", async () => {
    await expect(objects(fakePorts()).move({
      ids: ["f1"], folderId: "f1", vaultId: null,
    })).rejects.toThrow(/f1/);
  });

  it("refuses a root paste that would strand an object of an unlisted vault", async () => {
    const ports = fakePorts({
      connections: () => [conn({ vault_id: "hidden" })],
      accessibleVaultIds: () => ["personal", "vault-2"],
    });
    await expect(objects(ports).move({ ids: ["c1"], folderId: null, vaultId: null }))
      .rejects.toThrow(/source vault/);
  });

  it("copies without touching the original", async () => {
    const ports = fakePorts();
    const out = await objects(ports).copy({ ids: ["c1"], folderId: "f1", vaultId: null });
    expect(out.created).toBe(1);
    expect(ports.updateConnection).not.toHaveBeenCalled();
    expect(ports.deleteConnection).not.toHaveBeenCalled();
  });

  it("moves a snippet through its own store", async () => {
    const ports = fakePorts();
    const out = await objects(ports).move({ ids: ["s1"], folderId: "sf1", vaultId: null });
    expect(out.moved).toBe(1);
    expect(ports.updateSnippet).toHaveBeenCalledWith("s1", expect.objectContaining({ folder_id: "sf1" }));
  });
});

describe("objectPermissionsFor", () => {
  it("asks only for the kinds in the call", () => {
    expect(objectPermissionsFor(fakePorts(), { ids: ["s1"], folderId: null, vaultId: null }))
      .toEqual(["snippets:write"]);
  });

  it("makes a host ask for the keychain its cascade writes", () => {
    // applyCascade saves/updates the key and identity a host references, and the
    // duplicators copy their private material into the destination vault.
    expect(objectPermissionsFor(fakePorts(), { ids: ["c1"], folderId: null, vaultId: null }).sort())
      .toEqual(["connections:write", "identities:write", "keys:write"]);
  });

  it("gives every kind its own permission", () => {
    const perm = (id: string) =>
      objectPermissionsFor(fakePorts(), { ids: [id], folderId: null, vaultId: null });
    expect(perm("k1")).toEqual(["keys:write"]);
    expect(perm("i1")).toEqual(["identities:write"]);
    expect(perm("s1")).toEqual(["snippets:write"]);
    expect(perm("r1")).toEqual(["port_forwarding:write"]);
  });

  it("makes a folder ask for the kinds it carries, not folders:write alone", () => {
    // A folder move relocates its contents and a folder copy duplicates them,
    // key material included; folders:write alone would authorize neither.
    const perm = (id: string) =>
      objectPermissionsFor(fakePorts(), { ids: [id], folderId: null, vaultId: null }).sort();
    expect(perm("f1")).toEqual(["connections:write", "folders:write", "identities:write", "keys:write"]);
    expect(perm("sf1")).toEqual(["folders:write", "snippets:write"]);
    expect(objectPermissionsFor(
      fakePorts({ folders: () => [folder({ id: "fk", object_type: "keychain" })] }),
      { ids: ["fk"], folderId: null, vaultId: null },
    ).sort()).toEqual(["folders:write", "identities:write", "keys:write"]);
  });

  it("does not ask for vaults:write to move into another vault", () => {
    // A move or copy never creates or destroys a vault; vaults:write also deletes one.
    expect(objectPermissionsFor(fakePorts(), {
      ids: ["s1"], folderId: null, vaultId: "vault-2", allowCrossVault: true,
    })).toEqual(["snippets:write"]);
  });

  it("asks for everything when an id resolves to nothing", () => {
    const perms = objectPermissionsFor(fakePorts(), { ids: ["nope"], folderId: null, vaultId: null }).sort();
    expect(perms).toEqual([
      "connections:write", "folders:write", "identities:write",
      "keys:write", "port_forwarding:write", "snippets:write",
    ]);
  });
});
