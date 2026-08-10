import type { PluginVault } from "../api";

interface VaultRecord {
  id: string;
  name: string;
  teamId?: string;
}

interface VaultContents {
  connections: { id: string; vault_id?: string }[];
  keys: { id: string; vault_id?: string }[];
  identities: { id: string; vault_id?: string }[];
  snippets: { id: string; vault_id?: string }[];
  portForwardingRules: { id: string; vault_id?: string }[];
  folders: { id: string; vault_id?: string }[];
  snippetFolders: { id: string; vault_id?: string }[];
}

export interface VaultPorts {
  vaults: {
    list(): VaultRecord[];
    add(name: string): VaultRecord;
    rename(id: string, name: string): void;
    remove(id: string): void;
  };
  isTeamVault(id: string): boolean;
  contents(): Promise<VaultContents>;
  remove: {
    connection(id: string): Promise<void>;
    key(id: string): Promise<void>;
    identity(id: string): Promise<void>;
    snippet(id: string): Promise<void>;
    portForwardingRule(id: string): Promise<void>;
    folder(id: string): Promise<void>;
    snippetFolder(id: string): Promise<void>;
  };
}

/** An object with no vault_id sits in Personal, matching the vault filters everywhere else. */
const vaultOf = (o: { vault_id?: string }): string => o.vault_id ?? "personal";

/** Ordered so the error names kinds the way the Vaults settings page lists them. */
const KINDS = [
  ["connections", "connection", "connection"],
  ["keys", "key", "key"],
  ["identities", "identity", "identity"],
  ["snippets", "snippet", "snippet"],
  ["portForwardingRules", "port forwarding rule", "portForwardingRule"],
  ["folders", "folder", "folder"],
  ["snippetFolders", "snippet folder", "snippetFolder"],
] as const;

export function createVaultsAPI(ports: VaultPorts) {
  const find = (id: string): VaultRecord => {
    const vault = ports.vaults.list().find((v) => v.id === id);
    if (!vault) throw new Error(`Vault "${id}" not found`);
    return vault;
  };

  const refuseTeam = (vault: VaultRecord, verb: string): void => {
    if (ports.isTeamVault(vault.id)) {
      throw new Error(`Vault "${vault.name}" is a team vault and cannot be ${verb} from here`);
    }
  };

  const project = (v: VaultRecord): PluginVault => ({
    id: v.id,
    name: v.name,
    team: ports.isTeamVault(v.id),
  });

  /**
   * Ids in the vault, per kind, in KINDS order.
   *
   * `ports.contents` is async because the stores behind it are hydrated lazily
   * — the Snippets and Port Forwarding pages load their own. Counting an
   * unhydrated store reports an empty vault, which is exactly the orphaning
   * this refusal exists to prevent.
   */
  const contentsOf = async (vaultId: string) => {
    const all = await ports.contents();
    return KINDS.map(([field, label, remover]) => ({
      label,
      remover,
      ids: all[field].filter((o) => vaultOf(o) === vaultId).map((o) => o.id),
    }));
  };

  return {
    list: (): PluginVault[] => ports.vaults.list().map(project),

    create: (name: string): PluginVault => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("A vault name cannot be empty");
      return project(ports.vaults.add(trimmed));
    },

    rename: (id: string, name: string): void => {
      const vault = find(id);
      refuseTeam(vault, "renamed");
      const trimmed = name.trim();
      if (!trimmed) throw new Error("A vault name cannot be empty");
      ports.vaults.rename(id, trimmed);
    },

    /**
     * Refuses a vault that still holds something unless `cascade` is passed.
     *
     * The Vaults settings page deletes the vault record alone, which leaves its
     * contents alive with a vault_id nothing resolves — reachable by no listing.
     * A verb has no counts dialog in front of it, so it refuses instead.
     */
    delete: async (id: string, opts?: { cascade?: boolean }): Promise<void> => {
      const vault = find(id);
      if (id === "personal") throw new Error("The personal vault cannot be deleted");
      refuseTeam(vault, "deleted");

      const contents = (await contentsOf(id)).filter((c) => c.ids.length > 0);
      if (contents.length > 0 && !opts?.cascade) {
        const summary = contents
          .map((c) => `${c.ids.length} ${c.label}${c.ids.length === 1 ? "" : "s"}`)
          .join(", ");
        throw new Error(
          `Vault "${vault.name}" still holds ${summary}. Pass cascade to delete them with it.`,
        );
      }

      for (const { remover, ids } of contents) {
        for (const objectId of ids) await ports.remove[remover](objectId);
      }
      ports.vaults.remove(id);
    },
  };
}

export type VaultsAPI = ReturnType<typeof createVaultsAPI>;
