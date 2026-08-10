import type {
  Connection,
  ConnectionFormData,
  Folder,
  FolderFormData,
  Identity,
  IdentityFormData,
  PortForwardingRule,
  PortForwardingRuleFormData,
  Snippet,
  SnippetFormData,
  SshKey,
  SshKeyFormData,
} from "@/types";
import type { NavItem } from "@/stores/uiStore";
import type { VaultClipboard, VaultClipboardKind } from "@/stores/vaultClipboardStore";
import type { PluginObjectMoveInput, PluginObjectMoveOutcome } from "../api";
import { pasteFromClipboard, type CascadeEntry, type ClipboardAdapter } from "@/services/vaultClipboard";
import { vaultClipboardBase } from "@/utils/vaultClipboardBase";
import type { ClipboardHalf } from "@/services/clipboard/types";
import { connectionsClipboardHalf } from "@/services/clipboard/connections";
import { keychainClipboardHalf } from "@/services/clipboard/keychain";
import { portForwardingClipboardHalf } from "@/services/clipboard/portForwarding";
import { snippetsClipboardHalf } from "@/services/clipboard/snippets";
import { descendantFolders, itemsInFolderSubtree } from "@/utils/folderTree";
import { cloneFolderTree } from "@/utils/folderCopy";
import { moveFolderTreeToVault } from "@/utils/folderMove";
import { connectionToFormData } from "@/stores/connectionStore";
import { snippetToForm } from "@/utils/snippetForm";
import { ruleToForm } from "@/utils/portForwardingForm";
import { getSecret, storeSecret } from "@/services/vault";
import {
  transferConnectionSecrets,
  transferIdentitySecrets,
  transferKeySecrets,
} from "@/services/vaultSecrets";
import {
  publishConnectionSecrets,
  publishIdentitySecrets,
  publishKeySecrets,
  withdrawOrWarn,
} from "@/services/vaultObjectSecrets";

export type ObjectTab = "hosts" | "keychain" | "port_forwarding" | "snippets";

export type MoveInput = PluginObjectMoveInput;
export type MoveOutcome = PluginObjectMoveOutcome;

export interface ObjectsAPI {
  move(input: MoveInput): Promise<MoveOutcome>;
  copy(input: MoveInput): Promise<MoveOutcome>;
}

/**
 * Everything the four vault-object tabs are read and written through, headlessly.
 *
 * The reads are functions, not arrays: `hydrate` runs first and the lists must be
 * the post-hydration ones. The writes are the same store methods the pages call,
 * so the vault permission checks inside them still apply.
 */
export interface ObjectPorts {
  /** Loads the lazily-hydrated stores. See `run` for why it is not optional. */
  hydrate(): Promise<void>;
  can(permission: string, vaultId: string): boolean;
  isTeamVault(vaultId: string): boolean;
  vaults(): { id: string; name: string }[];
  accessibleVaultIds(): string[];

  connections(): Connection[];
  keys(): SshKey[];
  identities(): Identity[];
  snippets(): Snippet[];
  rules(): PortForwardingRule[];
  /** The connection, keychain and port_forwarding trees. */
  folders(): Folder[];
  snippetFolders(): Folder[];

  saveConnection(form: ConnectionFormData): Promise<{ id: string }>;
  updateConnection(id: string, form: ConnectionFormData): Promise<unknown>;
  deleteConnection(id: string): Promise<unknown>;
  loadConnections(): Promise<unknown>;

  saveKey(form: SshKeyFormData): Promise<{ id: string }>;
  updateKey(id: string, form: SshKeyFormData): Promise<unknown>;
  deleteKey(id: string): Promise<unknown>;
  loadKeys(): Promise<unknown>;

  saveIdentity(form: IdentityFormData): Promise<{ id: string }>;
  updateIdentity(id: string, form: IdentityFormData): Promise<unknown>;
  deleteIdentity(id: string): Promise<unknown>;
  loadIdentities(): Promise<unknown>;

  createSnippet(form: SnippetFormData): Promise<{ id: string }>;
  updateSnippet(id: string, form: SnippetFormData): Promise<unknown>;
  deleteSnippet(id: string): Promise<unknown>;

  createRule(form: PortForwardingRuleFormData): Promise<{ id: string }>;
  updateRule(id: string, form: PortForwardingRuleFormData): Promise<unknown>;
  deleteRule(id: string): Promise<unknown>;
  moveRuleFolder(id: string, folderId: string | null): Promise<unknown>;

  moveObjectsToFolder(
    ids: string[],
    objectType: "connection" | "key" | "identity",
    folderId: string | null,
  ): Promise<unknown>;
  saveFolder(data: FolderFormData): Promise<Folder>;
  updateFolder(id: string, data: FolderFormData): Promise<unknown>;
  deleteFolder(id: string): Promise<unknown>;
  moveFolder(id: string, parentFolderId: string | null): Promise<unknown>;
  saveSnippetFolder(data: FolderFormData): Promise<Folder>;
  updateSnippetFolder(id: string, data: FolderFormData): Promise<unknown>;
  deleteSnippetFolder(id: string): Promise<unknown>;
  moveSnippetFolder(id: string, parentFolderId: string | null): Promise<unknown>;
}

const NAV_ITEM: Record<ObjectTab, NavItem> = {
  hosts: "hosts",
  keychain: "keychain",
  port_forwarding: "port-forwarding",
  snippets: "snippets",
};

/** `object_type` on a folder record, per tab. Snippet folders live in their own store. */
const FOLDER_TYPE: Record<ObjectTab, string> = {
  hosts: "connection",
  keychain: "keychain",
  port_forwarding: "port_forwarding",
  snippets: "snippet",
};

const TAB_OF_FOLDER_TYPE: Record<string, ObjectTab> = {
  connection: "hosts",
  keychain: "keychain",
  port_forwarding: "port_forwarding",
  snippet: "snippets",
};

/** An object with no vault_id is in Personal, matching the vault filters everywhere else. */
const vaultOf = (o: { vault_id?: string | null }): string => o.vault_id ?? "personal";

// ─── Tab and kind resolution ──────────────────────────────────────────────

interface Located {
  tab: ObjectTab;
  kind: VaultClipboardKind | "folder";
}

function locate(ports: ObjectPorts, id: string): Located | null {
  if (ports.connections().some((c) => c.id === id)) return { tab: "hosts", kind: "connection" };
  if (ports.keys().some((k) => k.id === id)) return { tab: "keychain", kind: "key" };
  if (ports.identities().some((i) => i.id === id)) return { tab: "keychain", kind: "identity" };
  if (ports.rules().some((r) => r.id === id)) return { tab: "port_forwarding", kind: "port_forward" };
  if (ports.snippets().some((s) => s.id === id)) return { tab: "snippets", kind: "snippet" };
  const folder = ports.folders().find((f) => f.id === id);
  if (folder) {
    const tab = TAB_OF_FOLDER_TYPE[folder.object_type];
    if (tab) return { tab, kind: "folder" };
  }
  if (ports.snippetFolders().some((f) => f.id === id)) return { tab: "snippets", kind: "folder" };
  return null;
}

/**
 * The one tab the ids belong to.
 *
 * A paste is a single tab's operation — the clipboard carries the tab it was
 * filled on and `pasteFromClipboard` drops anything else — so a mixed set would
 * silently move only part of it. Refused instead, naming both tabs.
 */
function resolveTab(ports: ObjectPorts, ids: string[]): { tab: ObjectTab; located: Map<string, Located> } {
  if (ids.length === 0) throw new Error("No object ids given");
  const located = new Map<string, Located>();
  const tabs = new Set<ObjectTab>();
  for (const id of ids) {
    const found = locate(ports, id);
    if (!found) throw new Error(`Object "${id}" not found`);
    located.set(id, found);
    tabs.add(found.tab);
  }
  if (tabs.size > 1) {
    throw new Error(
      `Ids span more than one tab (${[...tabs].join(", ")}); move or copy one tab's objects at a time`,
    );
  }
  return { tab: [...tabs][0], located };
}

// ─── Per-tab duplication, used by a copy and by a folder clone ────────────

const copySecret = async (from: string, to: string): Promise<void> => {
  const value = await getSecret(from).catch(() => null);
  if (value) await storeSecret(to, value);
};

interface DuplicateOpts {
  vaultId?: string;
  keepName?: boolean;
  identityId?: string;
  keyId?: string;
}

// default name suffix kept in English until all creation sites are localized together (see i18n issue #14)
const cloneName = (name: string | undefined, keepName: boolean | undefined): string | undefined =>
  name ? (keepName ? name : `${name} (copy)`) : undefined;

function duplicators(ports: ObjectPorts) {
  const connection = async (conn: Connection, folderId: string | null, opts: DuplicateOpts = {}) => {
    const vaultId = opts.vaultId ?? vaultOf(conn);
    const created = await ports.saveConnection({
      ...connectionToFormData(conn),
      name: cloneName(conn.name, opts.keepName),
      identity_id: opts.identityId ?? conn.identity_id,
      key_id: opts.keyId ?? conn.key_id,
      folder_id: folderId ?? undefined,
      vault_id: vaultId,
    });
    if (conn.connection_type !== "serial") {
      await copySecret(`password:${conn.id}`, `password:${created.id}`);
      if (!conn.key_id) await copySecret(`key:${conn.id}`, `key:${created.id}`);
      await publishConnectionSecrets(created.id, vaultId);
    }
    return created;
  };

  const key = async (k: SshKey, folderId: string | null, opts: DuplicateOpts = {}) => {
    const vaultId = opts.vaultId ?? vaultOf(k);
    const created = await ports.saveKey({
      name: cloneName(k.name, opts.keepName),
      key_type: k.key_type,
      tags: [...k.tags],
      folder_id: folderId ?? undefined,
      vault_id: vaultId,
    });
    for (const part of ["private", "public", "passphrase"]) {
      await copySecret(`key:${k.id}:${part}`, `key:${created.id}:${part}`);
    }
    await publishKeySecrets(created.id, vaultId);
    return created;
  };

  const identity = async (i: Identity, folderId: string | null, opts: DuplicateOpts = {}) => {
    const vaultId = opts.vaultId ?? vaultOf(i);
    const created = await ports.saveIdentity({
      name: cloneName(i.name, opts.keepName),
      username: i.username,
      key_id: opts.keyId ?? i.key_id,
      tags: [...i.tags],
      folder_id: folderId ?? undefined,
      vault_id: vaultId,
    });
    await copySecret(`identity:${i.id}:password`, `identity:${created.id}:password`);
    await publishIdentitySecrets(created.id, vaultId);
    return created;
  };

  const snippet = (s: Snippet, folderId: string | null, opts: DuplicateOpts = {}) =>
    ports.createSnippet({
      ...snippetToForm(s),
      name: cloneName(s.name, opts.keepName) ?? s.name,
      folder_id: folderId ?? undefined,
      vault_id: opts.vaultId ?? s.vault_id,
      favorite: false,
    });

  const rule = (r: PortForwardingRule, folderId: string | null, opts: DuplicateOpts = {}) =>
    ports.createRule(ruleToForm(r, {
      name: cloneName(r.name, opts.keepName) ?? r.name,
      folder_id: folderId ?? undefined,
      vault_id: opts.vaultId ?? r.vault_id,
    }));

  return { connection, key, identity, snippet, rule };
}

// ─── Per-tab folder handling ──────────────────────────────────────────────

interface FolderOps {
  folders: Folder[];
  saveFolder(data: FolderFormData): Promise<Folder>;
  updateFolder(id: string, data: FolderFormData): Promise<unknown>;
  deleteFolder(id: string): Promise<unknown>;
  moveFolder(id: string, parentFolderId: string | null): Promise<unknown>;
  /** Recreates the items under `rootId` beneath the folders the clone just made. */
  copySubtreeItems(
    rootId: string,
    folderIdMap: Map<string, string>,
    newRootId: string,
    vaultId: string,
  ): Promise<void>;
  /** Carries the items under `rootId` into `vaultId` after the folders have moved. */
  migrateSubtreeItems(rootId: string, vaultId: string): Promise<void>;
}

function folderOpsFor(ports: ObjectPorts, tab: ObjectTab): FolderOps {
  const dup = duplicators(ports);
  const folders = tab === "snippets"
    ? ports.snippetFolders()
    : ports.folders().filter((f) => f.object_type === FOLDER_TYPE[tab]);
  const store = tab === "snippets"
    ? {
      saveFolder: ports.saveSnippetFolder,
      updateFolder: ports.updateSnippetFolder,
      deleteFolder: ports.deleteSnippetFolder,
      moveFolder: ports.moveSnippetFolder,
    }
    : {
      saveFolder: ports.saveFolder,
      updateFolder: ports.updateFolder,
      deleteFolder: ports.deleteFolder,
      moveFolder: ports.moveFolder,
    };

  const under = <T extends { folder_id?: string | null }>(items: T[], rootId: string): T[] =>
    itemsInFolderSubtree(items, folders, rootId);
  const destinationOf = (
    item: { folder_id?: string | null },
    folderIdMap: Map<string, string>,
    newRootId: string,
  ): string => folderIdMap.get(item.folder_id ?? "") ?? newRootId;

  const copySubtreeItems: FolderOps["copySubtreeItems"] = async (rootId, map, newRootId, vaultId) => {
    const opts = { vaultId, keepName: true };
    if (tab === "hosts") {
      for (const c of under(ports.connections(), rootId)) {
        await dup.connection(c, destinationOf(c, map, newRootId), opts);
      }
      return;
    }
    if (tab === "keychain") {
      // Keys first: an identity cloned from the same subtree must point at the
      // clone of its key, not back at the original in the source vault.
      const keyIdMap = new Map<string, string>();
      for (const k of under(ports.keys(), rootId)) {
        const created = await dup.key(k, destinationOf(k, map, newRootId), opts);
        keyIdMap.set(k.id, created.id);
      }
      for (const i of under(ports.identities(), rootId)) {
        await dup.identity(i, destinationOf(i, map, newRootId), {
          ...opts,
          keyId: i.key_id ? (keyIdMap.get(i.key_id) ?? i.key_id) : undefined,
        });
      }
      return;
    }
    if (tab === "port_forwarding") {
      for (const r of under(ports.rules(), rootId)) {
        await dup.rule(r, destinationOf(r, map, newRootId), opts);
      }
      return;
    }
    for (const s of under(ports.snippets(), rootId)) {
      await dup.snippet(s, destinationOf(s, map, newRootId), opts);
    }
  };

  const migrateSubtreeItems: FolderOps["migrateSubtreeItems"] = async (rootId, vaultId) => {
    if (tab === "hosts") {
      for (const c of under(ports.connections(), rootId)) {
        const from = vaultOf(c);
        await ports.updateConnection(c.id, { ...connectionToFormData(c), vault_id: vaultId });
        await transferConnectionSecrets(c.id, from, vaultId);
      }
      return;
    }
    if (tab === "keychain") {
      for (const k of under(ports.keys(), rootId)) {
        const from = vaultOf(k);
        await ports.updateKey(k.id, {
          name: k.name, key_type: k.key_type, tags: k.tags, folder_id: k.folder_id, vault_id: vaultId,
        });
        await transferKeySecrets(k.id, from, vaultId);
      }
      for (const i of under(ports.identities(), rootId)) {
        const from = vaultOf(i);
        await ports.updateIdentity(i.id, {
          name: i.name, username: i.username, key_id: i.key_id, tags: i.tags,
          folder_id: i.folder_id, vault_id: vaultId,
        });
        await transferIdentitySecrets(i.id, from, vaultId);
      }
      return;
    }
    if (tab === "port_forwarding") {
      for (const r of under(ports.rules(), rootId)) {
        await ports.updateRule(r.id, ruleToForm(r, { vault_id: vaultId }));
      }
      return;
    }
    for (const s of under(ports.snippets(), rootId)) {
      await ports.updateSnippet(s.id, { ...snippetToForm(s), vault_id: vaultId });
    }
  };

  return { folders, ...store, copySubtreeItems, migrateSubtreeItems };
}

// ─── The headless adapter ─────────────────────────────────────────────────

type ClipboardEntities = {
  kind: VaultClipboardKind;
  items: { id: string; vault_id?: string | null; folder_id?: string | null }[];
}[];

/** What each tab's ids are classified against, in the order the page lists them. */
const ENTITIES: Record<ObjectTab, (ports: ObjectPorts) => ClipboardEntities> = {
  hosts: (p) => [{ kind: "connection", items: p.connections() }],
  keychain: (p) => [
    { kind: "key", items: p.keys() },
    { kind: "identity", items: p.identities() },
  ],
  port_forwarding: (p) => [{ kind: "port_forward", items: p.rules() }],
  snippets: (p) => [{ kind: "snippet", items: p.snippets() }],
};

function halfFor(
  ports: ObjectPorts,
  tab: ObjectTab,
  ops: FolderOps,
  vaultForFolder: (folderId: string | null) => string | null,
  cascadeRemap: { identities: Map<string, string>; keys: Map<string, string> },
): ClipboardHalf {
  const dup = duplicators(ports);
  const inTree = <T extends { folder_id?: string | null }>(items: T[], folderId: string): T[] =>
    itemsInFolderSubtree(items, ops.folders, folderId);

  if (tab === "hosts") {
    return connectionsClipboardHalf({
      connections: ports.connections(),
      keys: ports.keys(),
      identities: ports.identities(),
      getConnectionsInFolderTree: (folderId) => inTree(ports.connections(), folderId),
      vaultForFolder,
      updateConnection: ports.updateConnection,
      deleteConnection: ports.deleteConnection,
      loadConnections: ports.loadConnections,
      moveObjectsToFolder: (ids, objectType, folderId) =>
        ports.moveObjectsToFolder(ids, objectType, folderId),
      duplicateInto: (conn, folderId, opts) => dup.connection(conn, folderId, opts),
      updateKey: ports.updateKey,
      saveKey: ports.saveKey,
      updateIdentity: ports.updateIdentity,
      saveIdentity: ports.saveIdentity,
      withdrawOrWarn: (p) => withdrawOrWarn(p as Promise<void>),
    }, cascadeRemap);
  }
  if (tab === "keychain") {
    return keychainClipboardHalf({
      keys: ports.keys(),
      identities: ports.identities(),
      keysInFolderTree: (folderId) => inTree(ports.keys(), folderId),
      identitiesInFolderTree: (folderId) => inTree(ports.identities(), folderId),
      vaultForFolder,
      updateKey: ports.updateKey,
      updateIdentity: ports.updateIdentity,
      moveObjectsToFolder: (ids, objectType, folderId) =>
        ports.moveObjectsToFolder(ids, objectType, folderId),
      loadKeys: ports.loadKeys,
      loadIdentities: ports.loadIdentities,
      duplicateKeyInto: (k, folderId, opts) => dup.key(k, folderId, opts),
      duplicateIdentityInto: (i, folderId, opts) => dup.identity(i, folderId, opts),
      deleteKey: ports.deleteKey,
      deleteIdentity: ports.deleteIdentity,
    });
  }
  if (tab === "port_forwarding") {
    return portForwardingClipboardHalf({
      rules: ports.rules(),
      connections: ports.connections(),
      getRulesInFolderTree: (folderId) => inTree(ports.rules(), folderId),
      vaultForFolder,
      moveRuleFolder: ports.moveRuleFolder,
      updateRule: ports.updateRule,
      duplicateRuleInto: (r, folderId, opts) => dup.rule(r, folderId, opts),
      deleteRule: ports.deleteRule,
    });
  }
  return snippetsClipboardHalf({
    snippets: ports.snippets(),
    getSnippetsInFolderTree: (folderId) => inTree(ports.snippets(), folderId),
    vaultForFolder,
    updateSnippet: ports.updateSnippet,
    duplicateSnippetInto: (s, folderId, opts) => dup.snippet(s, folderId, opts),
    deleteSnippet: ports.deleteSnippet,
  });
}

/**
 * The same adapter the page builds, with no page: no confirmation (the
 * `allowCrossVault` flag is the authorization, decided before this runs) and no
 * selection to update. Building it runs no store method, which is what lets the
 * cross-vault refusal below read `planCascade` without mutating anything.
 */
function buildAdapter(
  ports: ObjectPorts,
  tab: ObjectTab,
  input: MoveInput,
  ops: FolderOps,
  cascadeRemap: { identities: Map<string, string>; keys: Map<string, string> },
): ClipboardAdapter {
  const { vaultForFolder, adapter: base } = vaultClipboardBase({
    navItem: NAV_ITEM[tab],
    entities: ENTITIES[tab](ports),
    folders: ops.folders,
    selectedIdSet: new Set(input.ids),
    focusedId: null,
    activeFolderId: input.folderId,
    scopedVaultId: input.vaultId,
    accessibleVaultIds: ports.accessibleVaultIds(),
    vaultOptions: ports.vaults(),
    can: ports.can,
    confirmCrossVault: undefined,
    setSelection: () => {},
    migrateFolderTreeToVault: async (folder, parentFolderId, vaultId) => {
      await moveFolderTreeToVault({
        root: folder,
        subFolders: descendantFolders(ops.folders, folder.id),
        parentFolderId,
        vaultId,
        updateFolder: ops.updateFolder,
      });
      await ops.migrateSubtreeItems(folder.id, vaultId);
    },
    moveFolder: ops.moveFolder,
    copyFolderInto: async (folderId, parentFolderId, vaultId, opts) => {
      const folder = ops.folders.find((f) => f.id === folderId);
      if (!folder) throw new Error(`Folder "${folderId}" not found`);
      const targetVaultId = vaultId ?? vaultOf(folder);
      const { root, folderIdMap } = await cloneFolderTree({
        root: folder,
        subFolders: descendantFolders(ops.folders, folder.id),
        parentFolderId,
        vaultId: targetVaultId,
        keepName: opts?.keepName ?? false,
        saveFolder: ops.saveFolder,
      });
      await ops.copySubtreeItems(folder.id, folderIdMap, root.id, targetVaultId);
      return root;
    },
    deleteFolder: ops.deleteFolder,
  });

  return { ...base, ...halfFor(ports, tab, ops, vaultForFolder, cascadeRemap) };
}

// ─── Permissions ──────────────────────────────────────────────────────────

/** The plugin permission each kind's write needs — one per kind, nothing wider. */
const KIND_PERMISSION: Record<VaultClipboardKind | "folder", string> = {
  connection: "connections:write",
  port_forward: "port_forwarding:write",
  key: "keys:write",
  identity: "identities:write",
  snippet: "snippets:write",
  folder: "folders:write",
};

const ALL_OBJECT_PERMISSIONS = [...new Set(Object.values(KIND_PERMISSION))];

/** The kinds a tab's folder can hold — a folder travels with its contents. */
const TAB_CONTENT_KINDS: Record<ObjectTab, VaultClipboardKind[]> = {
  hosts: ["connection"],
  keychain: ["key", "identity"],
  port_forwarding: ["port_forward"],
  snippets: ["snippet"],
};

/**
 * What a call must be authorized for, from the kinds it names. An id that
 * resolves to nothing asks for everything — a wrong guess there would under-gate
 * the call.
 *
 * A folder asks for its tab's kinds too: moving one carries its contents into
 * the destination vault and copying one duplicates them, secrets included, so
 * `folders:write` alone would let a plugin relocate the keys it was never
 * granted. Taken from the tab rather than the subtree so an empty folder that
 * fills up between the gate and the paste cannot widen what was authorized.
 *
 * A destination vault adds nothing: a move or copy never creates or destroys a
 * vault, so demanding `vaults:write` — which also deletes them — for filing a
 * snippet one folder over would conflate two different capabilities.
 */
export function objectPermissionsFor(ports: ObjectPorts, input: MoveInput): string[] {
  const perms = new Set<string>();
  for (const id of input.ids) {
    const found = locate(ports, id);
    if (!found) {
      for (const p of ALL_OBJECT_PERMISSIONS) perms.add(p);
      continue;
    }
    perms.add(KIND_PERMISSION[found.kind]);
    if (found.kind === "folder") {
      for (const kind of TAB_CONTENT_KINDS[found.tab]) perms.add(KIND_PERMISSION[kind]);
    }
  }
  return [...perms];
}

// ─── The namespace ────────────────────────────────────────────────────────

interface CrossVaultPlan {
  /** Objects that would change vault. */
  count: number;
  targetVaultId: string;
  targetVaultName: string;
  cascade: CascadeEntry[];
}

export function createObjectsAPI(ports: ObjectPorts): ObjectsAPI {
  const nameOf = (vaultId: string): string =>
    ports.vaults().find((v) => v.id === vaultId)?.name ?? vaultId;

  const run = async (mode: "cut" | "copy", input: MoveInput): Promise<MoveOutcome> => {
    // Not optional: snippets, snippet folders, rules, keys and identities are
    // loaded by their own pages, and a headless read of an unhydrated store
    // reports an empty tab — which resolves every id to "not found" and, where
    // it does not, decides a paste has nothing to carry with it.
    await ports.hydrate();

    const { tab, located } = resolveTab(ports, input.ids);
    const ops = folderOpsFor(ports, tab);

    const destinationFolder = input.folderId === null
      ? null
      : ops.folders.find((f) => f.id === input.folderId);
    if (input.folderId !== null && !destinationFolder) {
      throw new Error(`Folder "${input.folderId}" not found on the ${tab} tab`);
    }
    if (destinationFolder && input.vaultId !== null && vaultOf(destinationFolder) !== input.vaultId) {
      throw new Error(
        `Folder "${destinationFolder.id}" is in vault "${vaultOf(destinationFolder)}", not "${input.vaultId}"`,
      );
    }

    // One remap for the whole operation: the cascade records what it created for
    // the paste that follows it, and both halves of that are this single call.
    const cascadeRemap = { identities: new Map<string, string>(), keys: new Map<string, string>() };
    const adapter = buildAdapter(ports, tab, input, ops, cascadeRemap);

    // The adapter's own answer, not a second derivation: a folder with no vault
    // names no destination there either, and the two must not disagree.
    const destination = adapter.targetVaultId();
    if (destination !== null && ports.isTeamVault(destination)) {
      throw new Error(`Vault "${nameOf(destination)}" is a team vault and cannot be written from here`);
    }

    // A cut out of a team vault is gated by the user's own vault permissions —
    // `removesFromSource` makes `pasteFromClipboard` check the source. A copy
    // removes nothing, so nothing checks the source, and a personal destination
    // authorizes unconditionally: the duplicate would carry the team's key
    // material into a personal vault with only this namespace's grant behind it.
    // Refused, as every other write verb refuses a team vault.
    if (mode === "copy") {
      const fromTeam = input.ids.find((id) => ports.isTeamVault(adapter.vaultIdOf(id)));
      if (fromTeam) {
        throw new Error(
          `Object "${fromTeam}" is in team vault "${nameOf(adapter.vaultIdOf(fromTeam))}" and cannot be copied from here`,
        );
      }
    }

    const items: { id: string; kind: VaultClipboardKind }[] = [];
    const folderIds: string[] = [];
    for (const id of input.ids) {
      const { kind } = located.get(id)!;
      if (kind === "folder") folderIds.push(id);
      else items.push({ id, kind });
    }
    const clipboard: VaultClipboard = {
      tab: NAV_ITEM[tab],
      mode,
      items,
      folderIds,
      sourceVaultIds: [...new Set(input.ids.map((id) => adapter.vaultIdOf(id)))],
    };

    // A folder cannot be filed under itself or under one of its own descendants.
    // The paste skips such a folder, which would otherwise report as a no-op.
    if (mode === "cut") {
      const impossible = folderIds.find((id) => !adapter.canMoveFolder(id, adapter.targetFolderId()));
      if (impossible) {
        throw new Error(`Refused: folder "${impossible}" cannot be filed under itself or its own subtree`);
      }
    }

    // Before any store method runs, and without starting the paste: a caller that
    // did not ask to cross vaults gets the plan back and can re-issue informed.
    if (destination !== null && !input.allowCrossVault) {
      const crossing = input.ids.filter((id) => adapter.vaultIdOf(id) !== destination);
      if (crossing.length > 0) {
        const plan: CrossVaultPlan = {
          count: crossing.length,
          targetVaultId: destination,
          targetVaultName: nameOf(destination),
          cascade: adapter.planCascade?.(items, folderIds, destination, mode) ?? [],
        };
        throw new Error(
          `Refused: this would move ${crossing.length} object(s) into another vault. `
          + `Pass allowCrossVault to authorize it. ${JSON.stringify({ plan })}`,
        );
      }
    }

    const result = await pasteFromClipboard(clipboard, adapter);
    // Every non-mutating outcome is a refusal here. Reported as a success it
    // reads as "moved 0, nothing wrong", which is how a silently dropped paste
    // looks to a caller with no toast to see.
    if (result.blocked?.length) {
      throw new Error(`Refused: missing ${result.blocked.join(", ")}`);
    }
    if (result.dangling?.length) {
      throw new Error(
        `Refused: would leave ${result.dangling.join(", ")} referenced from outside the destination vault`,
      );
    }
    // Only when nothing landed: a partial paste has already written, and pushed
    // its undo entry, so throwing would lose the counts the caller has to act on.
    if (result.crossVaultAtRoot && result.moved === 0 && result.created === 0) {
      throw new Error("Refused: the destination root does not show the source vault");
    }
    return { moved: result.moved, created: result.created, skipped: result.skipped };
  };

  return {
    move: (input) => run("cut", input),
    copy: (input) => run("copy", input),
  };
}
