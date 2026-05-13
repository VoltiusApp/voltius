import type { Connection, Folder, Identity, Snippet, SshKey } from "@/types";

export type TeamVaultPermission =
  | "VIEW_SECRETS"
  | "COPY_SECRETS"
  | "EDIT_CONNECTIONS"
  | "EDIT_IDENTITIES"
  | "EDIT_KEYS"
  | "EDIT_FOLDERS";

export type TransferOperation = "move" | "copy";

export interface TransferSelection {
  connectionIds?: string[];
  identityIds?: string[];
  keyIds?: string[];
  folderIds?: string[];
  snippetIds?: string[];
  snippetFolderIds?: string[];
}

export interface BuildTransferPlanInput {
  operation: TransferOperation;
  targetVaultId: string;
  selected: TransferSelection;
  can: (permission: TeamVaultPermission, vaultId: string) => boolean;
  connections: Connection[];
  identities: Identity[];
  keys: SshKey[];
  folders: Folder[];
  snippets: Snippet[];
  snippetFolders: Folder[];
}

export interface TeamVaultTransferPlan {
  operation: TransferOperation;
  targetVaultId: string;
  connections: Map<string, Connection>;
  identities: Map<string, Identity>;
  keys: Map<string, SshKey>;
  folders: Map<string, Folder>;
  snippets: Map<string, Snippet>;
  snippetFolders: Map<string, Folder>;
  sourcePermissions: TeamVaultPermission[];
  destinationPermissions: TeamVaultPermission[];
  deniedReasons: string[];
  allowed: boolean;
}

function addPermission(set: Set<TeamVaultPermission>, permission: TeamVaultPermission) {
  set.add(permission);
}

function vaultIdOf(item: { vault_id?: string }) {
  return item.vault_id ?? "personal";
}

function addIdentityDependencies(
  identity: Identity | undefined,
  identities: Map<string, Identity>,
  keys: Map<string, SshKey>,
  allKeys: SshKey[],
) {
  if (!identity) return;
  identities.set(identity.id, identity);
  if (identity.key_id) {
    const key = allKeys.find((k) => k.id === identity.key_id);
    if (key) keys.set(key.id, key);
  }
}

function collectSubFolders(rootId: string, folders: Folder[], out: Map<string, Folder>) {
  const root = folders.find((f) => f.id === rootId);
  if (!root || out.has(root.id)) return;
  out.set(root.id, root);
  for (const child of folders.filter((f) => f.parent_folder_id === root.id)) {
    collectSubFolders(child.id, folders, out);
  }
}

function sortedPermissions(set: Set<TeamVaultPermission>): TeamVaultPermission[] {
  return [...set].sort();
}

export function buildTeamVaultTransferPlan(input: BuildTransferPlanInput): TeamVaultTransferPlan {
  const connections = new Map<string, Connection>();
  const identities = new Map<string, Identity>();
  const keys = new Map<string, SshKey>();
  const folders = new Map<string, Folder>();
  const snippets = new Map<string, Snippet>();
  const snippetFolders = new Map<string, Folder>();
  const sourcePermissions = new Set<TeamVaultPermission>();
  const destinationPermissions = new Set<TeamVaultPermission>();

  for (const id of input.selected.connectionIds ?? []) {
    const conn = input.connections.find((c) => c.id === id);
    if (conn) connections.set(conn.id, conn);
  }
  for (const id of input.selected.identityIds ?? []) {
    const identity = input.identities.find((i) => i.id === id);
    addIdentityDependencies(identity, identities, keys, input.keys);
  }
  for (const id of input.selected.keyIds ?? []) {
    const key = input.keys.find((k) => k.id === id);
    if (key) keys.set(key.id, key);
  }
  for (const id of input.selected.snippetIds ?? []) {
    const snippet = input.snippets.find((s) => s.id === id);
    if (snippet) snippets.set(snippet.id, snippet);
  }
  for (const id of input.selected.folderIds ?? []) collectSubFolders(id, input.folders, folders);
  for (const id of input.selected.snippetFolderIds ?? []) collectSubFolders(id, input.snippetFolders, snippetFolders);

  for (const folder of folders.values()) {
    for (const conn of input.connections.filter((c) => c.folder_id === folder.id)) connections.set(conn.id, conn);
    for (const identity of input.identities.filter((i) => i.folder_id === folder.id)) addIdentityDependencies(identity, identities, keys, input.keys);
    for (const key of input.keys.filter((k) => k.folder_id === folder.id)) keys.set(key.id, key);
  }

  for (const folder of snippetFolders.values()) {
    for (const snippet of input.snippets.filter((s) => s.folder_id === folder.id)) snippets.set(snippet.id, snippet);
  }

  for (const conn of connections.values()) {
    addPermission(destinationPermissions, "EDIT_CONNECTIONS");
    if (input.operation === "move") addPermission(sourcePermissions, "EDIT_CONNECTIONS");
    const primaryIdentity = conn.identity_id ? input.identities.find((i) => i.id === conn.identity_id) : undefined;
    addIdentityDependencies(primaryIdentity, identities, keys, input.keys);
    for (const jumpHost of conn.jump_hosts ?? []) {
      const jumpIdentity = jumpHost.identity_id ? input.identities.find((i) => i.id === jumpHost.identity_id) : undefined;
      addIdentityDependencies(jumpIdentity, identities, keys, input.keys);
    }
  }

  if (identities.size > 0) {
    addPermission(destinationPermissions, "EDIT_IDENTITIES");
    if (input.operation === "move") addPermission(sourcePermissions, "EDIT_IDENTITIES");
  }
  if (keys.size > 0) {
    addPermission(destinationPermissions, "EDIT_KEYS");
    if (input.operation === "move") addPermission(sourcePermissions, "EDIT_KEYS");
  }
  if (folders.size > 0 || snippetFolders.size > 0) {
    addPermission(destinationPermissions, "EDIT_FOLDERS");
    if (input.operation === "move") addPermission(sourcePermissions, "EDIT_FOLDERS");
  }
  if (snippets.size > 0) {
    addPermission(destinationPermissions, "EDIT_CONNECTIONS");
    if (input.operation === "move") addPermission(sourcePermissions, "EDIT_CONNECTIONS");
  }

  if (input.operation === "copy" && (connections.size > 0 || identities.size > 0 || keys.size > 0)) {
    addPermission(sourcePermissions, "VIEW_SECRETS");
    addPermission(sourcePermissions, "COPY_SECRETS");
  }

  const deniedReasons: string[] = [];
  for (const permission of destinationPermissions) {
    if (!input.can(permission, input.targetVaultId)) deniedReasons.push(`Missing ${permission} on ${input.targetVaultId}`);
  }
  const sourceVaultIds = new Set([
    ...[...connections.values()].map(vaultIdOf),
    ...[...identities.values()].map(vaultIdOf),
    ...[...keys.values()].map(vaultIdOf),
    ...[...folders.values()].map(vaultIdOf),
    ...[...snippets.values()].map(vaultIdOf),
    ...[...snippetFolders.values()].map(vaultIdOf),
  ]);
  for (const vaultId of sourceVaultIds) {
    for (const permission of sourcePermissions) {
      if (!input.can(permission, vaultId)) deniedReasons.push(`Missing ${permission} on ${vaultId}`);
    }
  }

  return {
    operation: input.operation,
    targetVaultId: input.targetVaultId,
    connections,
    identities,
    keys,
    folders,
    snippets,
    snippetFolders,
    sourcePermissions: sortedPermissions(sourcePermissions),
    destinationPermissions: sortedPermissions(destinationPermissions),
    deniedReasons,
    allowed: deniedReasons.length === 0,
  };
}
