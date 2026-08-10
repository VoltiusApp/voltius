import type { PluginFolder, PluginFolderKind } from "../api";

interface FolderRecord {
  id: string;
  name: string;
  object_type: string;
  vault_id?: string;
  parent_folder_id?: string;
}

export interface FolderWrite {
  name: string;
  object_type: string;
  vault_id?: string;
  parent_folder_id?: string;
}

export interface FolderPorts {
  /** connection, keychain and port_forwarding folders. */
  general: {
    list(): FolderRecord[];
    save(data: FolderWrite): Promise<FolderRecord>;
    update(id: string, data: FolderWrite): Promise<void>;
    remove(id: string, cascade: boolean): Promise<void>;
  };
  /** Snippet folders live in their own store, and its delete takes no cascade flag. */
  snippet: {
    list(): FolderRecord[];
    save(data: FolderWrite): Promise<FolderRecord>;
    update(id: string, data: FolderWrite): Promise<void>;
    remove(id: string): Promise<void>;
  };
  isTeamVault(id: string): boolean;
  /** False for a vault id nothing resolves — a folder written into one is invisible. */
  vaultExists(id: string): boolean;
}

export const FOLDER_KINDS: PluginFolderKind[] = [
  "connection",
  "keychain",
  "port_forwarding",
  "snippet",
];

const assertKind = (kind: string): PluginFolderKind => {
  if (!(FOLDER_KINDS as string[]).includes(kind)) {
    throw new Error(`Unknown folder kind "${kind}". Use one of: ${FOLDER_KINDS.join(", ")}`);
  }
  return kind as PluginFolderKind;
};

export function createFoldersAPI(ports: FolderPorts) {
  const project = (f: FolderRecord): PluginFolder => ({
    id: f.id,
    name: f.name,
    kind: f.object_type as PluginFolderKind,
    vaultId: f.vault_id ?? "personal",
    parentFolderId: f.parent_folder_id ?? null,
    team: ports.isTeamVault(f.vault_id ?? "personal"),
  });

  const all = (): FolderRecord[] => [...ports.general.list(), ...ports.snippet.list()];

  const findRecord = (id: string): FolderRecord => {
    const found = all().find((f) => f.id === id);
    if (!found) throw new Error(`Folder "${id}" not found`);
    return found;
  };

  const refuseTeam = (vaultId: string, verb: string): void => {
    if (ports.isTeamVault(vaultId)) {
      throw new Error(`Folder is in team vault "${vaultId}" and cannot be ${verb} from here`);
    }
  };

  const requireName = (name: string): string => {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("A folder name cannot be empty");
    return trimmed;
  };

  return {
    list: (kind?: PluginFolderKind): PluginFolder[] => {
      if (kind === undefined) return all().map(project);
      const validated = assertKind(kind);
      const source = validated === "snippet" ? ports.snippet.list() : ports.general.list();
      return source.filter((f) => f.object_type === validated).map(project);
    },

    create: async (input: {
      kind: PluginFolderKind;
      name: string;
      vaultId?: string;
      parentFolderId?: string;
    }): Promise<PluginFolder> => {
      const kind = assertKind(input.kind);
      const vaultId = input.vaultId ?? "personal";
      if (!ports.vaultExists(vaultId)) {
        throw new Error(`Vault "${vaultId}" not found`);
      }
      refuseTeam(vaultId, "created in");
      if (input.parentFolderId !== undefined) {
        // An unresolvable parent, a parent of another kind, or one in another
        // vault all produce a folder no page lists — it exists but is
        // unreachable, so each is refused rather than silently flattened.
        const parent = all().find((f) => f.id === input.parentFolderId);
        if (!parent) throw new Error(`Parent folder "${input.parentFolderId}" not found`);
        if (parent.object_type !== kind) {
          throw new Error(
            `Parent folder "${input.parentFolderId}" is of kind ${parent.object_type}, not ${kind}`,
          );
        }
        if ((parent.vault_id ?? "personal") !== vaultId) {
          throw new Error(`Parent folder "${input.parentFolderId}" is in another vault`);
        }
      }
      const data: FolderWrite = {
        name: requireName(input.name),
        object_type: kind,
        vault_id: vaultId,
        parent_folder_id: input.parentFolderId,
      };
      const store = kind === "snippet" ? ports.snippet : ports.general;
      return project(await store.save(data));
    },

    /** Name only: kind, vault and parent are carried over so a rename cannot reparent. */
    rename: async (id: string, name: string): Promise<void> => {
      const record = findRecord(id);
      refuseTeam(record.vault_id ?? "personal", "renamed");
      const data: FolderWrite = {
        name: requireName(name),
        object_type: record.object_type,
        vault_id: record.vault_id,
        parent_folder_id: record.parent_folder_id,
      };
      if (record.object_type === "snippet") await ports.snippet.update(id, data);
      else await ports.general.update(id, data);
    },

    delete: async (id: string, opts?: { cascade?: boolean }): Promise<void> => {
      const record = findRecord(id);
      refuseTeam(record.vault_id ?? "personal", "deleted");
      if (record.object_type === "snippet") {
        // Refused rather than ignored: the snippet store always cascades, and
        // silently accepting cascade:false would promise contents survive.
        if (opts?.cascade === false) {
          throw new Error("A snippet folder always deletes its contents; cascade cannot be disabled");
        }
        await ports.snippet.remove(id);
        return;
      }
      await ports.general.remove(id, opts?.cascade !== false);
    },
  };
}

export type FoldersAPI = ReturnType<typeof createFoldersAPI>;
