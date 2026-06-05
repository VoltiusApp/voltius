import type {
  Connection, ConnectionFormData,
  Folder, FolderFormData,
  Identity, IdentityFormData,
  PortForwardingRule, PortForwardingRuleFormData,
  Snippet, SnippetFormData,
  SshKey, SshKeyFormData,
} from "@/types";

// ─── Store slices ─────────────────────────────────────────────────────────────
// All data the export/import system reads from Zustand, passed as plain objects
// so handlers don't need to import individual stores.

export interface StoreSlices {
  connections: Connection[];
  identities: Identity[];
  keys: SshKey[];
  folders: Folder[];
  snippets: Snippet[];
  snippetFolders: Folder[];
  pfRules: PortForwardingRule[];
}

// Store methods needed during import, grouped into one object instead of N params.
export interface ImportStores {
  saveFolder(data: FolderFormData): Promise<Folder>;
  saveSnippetFolder(data: FolderFormData): Promise<Folder>;
  saveKey(data: SshKeyFormData): Promise<SshKey>;
  saveIdentity(data: IdentityFormData): Promise<Identity>;
  saveConnection(data: ConnectionFormData): Promise<Connection>;
  updateConnection(id: string, data: ConnectionFormData): Promise<void>;
  createSnippet(data: SnippetFormData): Promise<Snippet>;
  createPfRule(data: PortForwardingRuleFormData): Promise<PortForwardingRule>;
}

// Store reload methods called after a successful import.
export interface ReloadFns {
  loadConnections(): Promise<void>;
  loadIdentities(): Promise<void>;
  loadKeys(): Promise<void>;
  loadFolders(): Promise<void>;
  loadSnippets(): Promise<void>;
  loadSnippetFolders(): Promise<void>;
  loadPfRules(): Promise<void>;
}

// ─── Selection props ──────────────────────────────────────────────────────────
// Generic over handler keys ("connections", "keys", "snippets", …) so every
// entity type flows through one path. Handlers read it only via the helpers below.

export interface SelectionProps {
  single?: { key: string; id: string };
  bulk?: Partial<Record<string, string[]>>;
}

// The handler keys the selection targets, or null for a full export. An empty
// bulk list does not count, so keys-only (passed with `identities: []`) → {keys}.
export function selectionTargets(s: SelectionProps): Set<string> | null {
  if (s.single) return new Set([s.single.key]);
  if (s.bulk) {
    const keys = Object.keys(s.bulk).filter((k) => (s.bulk![k]?.length ?? 0) > 0);
    if (keys.length > 0) return new Set(keys);
  }
  return null;
}

export function handlerActive(key: string, s: SelectionProps): boolean {
  const targets = selectionTargets(s);
  return targets === null || targets.has(key);
}

// The ids `key` should restrict its export to, or null for "all in vault".
export function selectedIds(key: string, s: SelectionProps): string[] | null {
  if (s.single?.key === key) return [s.single.id];
  const bulk = s.bulk?.[key];
  return bulk && bulk.length > 0 ? bulk : null;
}

export function isSingleSelection(key: string, s: SelectionProps): boolean {
  return s.single?.key === key;
}

export function hasSelection(s: SelectionProps): boolean {
  return selectionTargets(s) !== null;
}

// ─── Export context ───────────────────────────────────────────────────────────
// Shared mutable state threaded through all export handlers.
// Handlers read allFolders/allIdentities/allKeys for cascade resolution
// and write into the eid maps so later handlers can cross-reference.

export interface ExportCtx {
  folderEidMap: Map<string, string>;
  snippetFolderEidMap: Map<string, string>;
  keyEidMap: Map<string, string>;
  identityEidMap: Map<string, string>;
  connectionEidMap: Map<string, string>;
  allFolders: Folder[];
  allSnippetFolders: Folder[];
  allIdentities: Identity[];
  allKeys: SshKey[];
}

// ─── Import context ───────────────────────────────────────────────────────────
// Shared mutable state threaded through all import handlers.
// Eid maps are populated by each handler so later handlers can resolve refs.

export interface ImportCtx {
  vault_id: string;
  tag: string;
  skipDupes: boolean;
  existingConnections: Connection[];
  existingKeys: SshKey[];
  existingIdentities: Identity[];
  existingSnippets: Snippet[];
  existingPfRules: PortForwardingRule[];
  folderEidMap: Map<string, string>;
  snippetFolderEidMap: Map<string, string>;
  keyEidMap: Map<string, string>;
  identityEidMap: Map<string, string>;
  connectionEidMap: Map<string, string>;
  stores: ImportStores;
}

export function existingConnectionsForVault<T extends { vault_id?: string }>(connections: T[], vault_id: string): T[] {
  return connections.filter((connection) => (connection.vault_id ?? "personal") === vault_id);
}
