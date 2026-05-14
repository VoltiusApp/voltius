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
// Forwarded from the modal's props for single-item and bulk-item export modes.

export interface SelectionProps {
  singleConnectionId?: string;
  singleKeyId?: string;
  singleIdentityId?: string;
  connectionIds?: string[];
  keyIds?: string[];
  identityIds?: string[];
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
