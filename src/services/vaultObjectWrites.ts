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
import type { VaultClipboardKind } from "@/stores/vaultClipboardStore";
import { connectionToFormData } from "@/stores/connectionStore";
import { getSecret, storeSecret } from "@/services/vault";
import { reportUploadFailure } from "@/services/secretRouting";
import { moveWithSecrets } from "@/services/vaultObjectSecrets";
import { secretKeysFor, type SecretObjectKind } from "@/services/teamVaultSecretKeys";
import { copyingRulesOf } from "@/services/ruleSetIntent";
import { snippetToForm } from "@/utils/snippetForm";
import { ruleToForm } from "@/utils/portForwardingForm";
import type { VaultObject, VaultObjectCatalogue } from "@/services/vaultObjectRefs";

/** The stores behind the four vault-object tabs. Reads span team vaults. */
export interface VaultObjectPorts {
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

export const catalogueOf = (ports: VaultObjectPorts): VaultObjectCatalogue => ({
  connections: ports.connections(),
  identities: ports.identities(),
  keys: ports.keys(),
  snippets: ports.snippets(),
  rules: ports.rules(),
});

/** Where an object lands and what it now points at. `folderId` undefined keeps the one it has. */
export interface Placement {
  vaultId: string;
  folderId?: string | null;
  links: Record<string, unknown>;
}

export interface VaultObjectWrites {
  duplicate(kind: VaultClipboardKind, o: VaultObject, at: Placement & { keepName: boolean }): Promise<string>;
  moveToVault(kind: VaultClipboardKind, o: VaultObject, at: Placement): Promise<void>;
  moveWithinVault(kind: VaultClipboardKind, objects: VaultObject[], folderId: string | null): Promise<void>;
  /** Rewrites only the links of an object already where it belongs. */
  relink(kind: VaultClipboardKind, o: VaultObject, links: Record<string, unknown>): Promise<void>;
  remove(kind: VaultClipboardKind, id: string): Promise<void>;
}

// default name suffix kept in English until all creation sites are localized together (see i18n issue #14)
const cloneName = (name: string | undefined, keepName: boolean): string | undefined =>
  name ? (keepName ? name : `${name} (copy)`) : name;

const isInlineKeySecret = (localKey: string) => localKey.startsWith("key:") || localKey.startsWith("passphrase:");

/** A host with a keychain key keeps no inline key material of its own worth copying. */
export async function copyObjectSecrets(kind: SecretObjectKind, fromId: string, toId: string, skipInlineKey = false) {
  const targets = secretKeysFor(kind, toId);
  for (const [i, from] of secretKeysFor(kind, fromId).entries()) {
    if (skipInlineKey && isInlineKeySecret(from)) continue;
    const value = await getSecret(from).catch(() => null);
    if (value) await storeSecret(targets[i], value).catch(reportUploadFailure(`copy ${kind} secret`));
  }
}

const folderField = (o: VaultObject, folderId: string | null | undefined) =>
  folderId === undefined ? o.folder_id ?? undefined : folderId ?? undefined;

/** The object as its store's form, placed and relinked. */
function formOf(kind: VaultClipboardKind, o: VaultObject, at: Placement, name?: string): object {
  const placed = { folder_id: folderField(o, at.folderId), vault_id: at.vaultId, ...at.links };
  switch (kind) {
    case "connection": {
      const c = o as Connection;
      return { ...connectionToFormData(c), ...placed, name: name ?? c.name };
    }
    case "key": {
      const k = o as SshKey;
      return { name: name ?? k.name, key_type: k.key_type, tags: k.tags, ...placed };
    }
    case "identity": {
      const i = o as Identity;
      return { name: name ?? i.name, username: i.username, key_id: i.key_id, tags: i.tags, ...placed };
    }
    case "snippet": {
      const s = o as Snippet;
      return { ...snippetToForm(s), ...placed, name: name ?? s.name };
    }
    case "port_forward": {
      const r = o as PortForwardingRule;
      return ruleToForm(r, { ...placed, name: name ?? r.name } as Partial<PortForwardingRuleFormData>);
    }
  }
}

const SECRET_KIND: Partial<Record<VaultClipboardKind, SecretObjectKind>> = {
  connection: "connection",
  key: "key",
  identity: "identity",
};

const FOLDER_OBJECT_TYPE: Partial<Record<VaultClipboardKind, "connection" | "key" | "identity">> = {
  connection: "connection",
  key: "key",
  identity: "identity",
};

export function vaultObjectWrites(ports: VaultObjectPorts): VaultObjectWrites {
  const create = (kind: VaultClipboardKind, form: object): Promise<{ id: string }> => {
    switch (kind) {
      case "connection": return ports.saveConnection(form as ConnectionFormData);
      case "key": return ports.saveKey(form as SshKeyFormData);
      case "identity": return ports.saveIdentity(form as IdentityFormData);
      case "snippet": return ports.createSnippet(form as SnippetFormData);
      case "port_forward": return ports.createRule(form as PortForwardingRuleFormData);
    }
  };
  const update = (kind: VaultClipboardKind, id: string, form: object): Promise<unknown> => {
    switch (kind) {
      case "connection": return ports.updateConnection(id, form as ConnectionFormData);
      case "key": return ports.updateKey(id, form as SshKeyFormData);
      case "identity": return ports.updateIdentity(id, form as IdentityFormData);
      case "snippet": return ports.updateSnippet(id, form as SnippetFormData);
      case "port_forward": return ports.updateRule(id, form as PortForwardingRuleFormData);
    }
  };
  const reload: Partial<Record<VaultClipboardKind, () => Promise<unknown>>> = {
    connection: ports.loadConnections,
    key: ports.loadKeys,
    identity: ports.loadIdentities,
  };

  return {
    duplicate: async (kind, o, at) => {
      const name = cloneName((o as { name?: string }).name, at.keepName);
      const form = copyingRulesOf(formOf(kind, o, at, name), o.id);
      const created = await create(kind, kind === "snippet" ? { ...form, favorite: false } : form);
      const secretKind = SECRET_KIND[kind];
      if (secretKind && (o as Connection).connection_type !== "serial") {
        await copyObjectSecrets(secretKind, o.id, created.id, kind === "connection" && !!(o as Connection).key_id);
      }
      return created.id;
    },
    moveToVault: async (kind, o, at) => {
      const form = formOf(kind, o, at);
      const secretKind = SECRET_KIND[kind];
      if (secretKind) await moveWithSecrets(secretKind, o, at.vaultId, () => update(kind, o.id, form));
      else await update(kind, o.id, form);
    },
    moveWithinVault: async (kind, objects, folderId) => {
      if (objects.length === 0) return;
      const objectType = FOLDER_OBJECT_TYPE[kind];
      if (objectType) {
        await ports.moveObjectsToFolder(objects.map((o) => o.id), objectType, folderId);
        await reload[kind]?.();
        return;
      }
      for (const o of objects) {
        if (kind === "port_forward") await ports.moveRuleFolder(o.id, folderId);
        else await update(kind, o.id, formOf(kind, o, { vaultId: o.vault_id ?? "personal", folderId, links: {} }));
      }
    },
    relink: (kind, o, links) => update(kind, o.id, formOf(kind, o, { vaultId: o.vault_id ?? "personal", links })).then(() => {}),
    remove: async (kind, id) => {
      switch (kind) {
        case "connection": await ports.deleteConnection(id); break;
        case "key": await ports.deleteKey(id); break;
        case "identity": await ports.deleteIdentity(id); break;
        case "snippet": await ports.deleteSnippet(id); break;
        case "port_forward": await ports.deleteRule(id); break;
      }
    },
  };
}

/** The "Duplicate" action: a "(copy)" beside the original, same vault and folder, same links. */
export const duplicateInPlace = (ports: VaultObjectPorts, kind: VaultClipboardKind, o: VaultObject): Promise<string> =>
  vaultObjectWrites(ports).duplicate(kind, o, {
    vaultId: o.vault_id ?? "personal",
    folderId: o.folder_id ?? null,
    keepName: false,
    links: {},
  });
