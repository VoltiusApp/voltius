import type { Snippet, SnippetFormData } from "@/types";
import type { PluginSnippet, PluginSnippetInput } from "../api";
import { vaultOf } from "./vaultOf";

export interface SnippetPorts {
  /**
   * The Snippets page loads this store itself, so a headless read of it on a
   * cold app reports an empty list — "this vault has no snippets" for a vault
   * full of them. Every read here hydrates first.
   */
  hydrate(): Promise<void>;
  list(): Snippet[];
  create(data: SnippetFormData): Promise<Snippet>;
  update(id: string, data: SnippetFormData): Promise<void>;
  remove(id: string): Promise<void>;
  isTeamVault(vaultId: string): boolean;
}

const project = (s: Snippet): PluginSnippet => ({
  id: s.id,
  name: s.name,
  steps: s.steps,
  description: s.description,
  tags: s.tags,
  favorite: s.favorite,
  only_for_connection_tags: s.only_for_connection_tags,
  only_for_distros: s.only_for_distros,
  vault_id: vaultOf(s),
  folder_id: s.folder_id ?? null,
});

/**
 * The full record a store write wants, from a partial patch.
 *
 * `updateSnippet` takes a whole SnippetFormData, so a patch that named one field
 * would blank every other one. Read-modify-write against the current record
 * instead — the same thing the form does when it saves.
 */
const formFrom = (base: Snippet | null, input: Partial<PluginSnippetInput>): SnippetFormData => ({
  name: input.name ?? base?.name ?? "",
  steps: input.steps ?? base?.steps ?? [],
  description: input.description ?? base?.description,
  tags: input.tags ?? base?.tags ?? [],
  favorite: input.favorite ?? base?.favorite ?? false,
  only_for_connection_tags: input.only_for_connection_tags ?? base?.only_for_connection_tags ?? [],
  only_for_distros: input.only_for_distros ?? base?.only_for_distros ?? [],
  folder_id: input.folder_id ?? base?.folder_id,
  vault_id: input.vault_id ?? (base ? vaultOf(base) : undefined),
});

export function createSnippetsAPI(ports: SnippetPorts) {
  const find = async (id: string): Promise<Snippet> => {
    await ports.hydrate();
    const found = ports.list().find((s) => s.id === id);
    if (!found) throw new Error(`Snippet "${id}" not found`);
    return found;
  };

  /** Refused on the object's OWN vault, the way every other write verb does:
   *  rewriting a team record changes it for every teammate. */
  const refuseTeam = (s: Snippet, verb: string): void => {
    if (ports.isTeamVault(vaultOf(s))) {
      throw new Error(`Snippet "${s.name}" is in a team vault and cannot be ${verb} from here`);
    }
  };

  /** A name the patch does not mention is left alone; one it blanks is refused. */
  const checkInput = (input: Partial<PluginSnippetInput>): void => {
    if (input.name !== undefined && !input.name.trim()) {
      throw new Error("A snippet name cannot be empty");
    }
    if (input.vault_id && ports.isTeamVault(input.vault_id)) {
      throw new Error(`Vault "${input.vault_id}" is a team vault and cannot be written from here`);
    }
  };

  return {
    list: async (): Promise<PluginSnippet[]> => {
      await ports.hydrate();
      return ports.list().map(project);
    },

    create: async (input: PluginSnippetInput): Promise<PluginSnippet> => {
      if (!input.name?.trim()) throw new Error("A snippet name cannot be empty");
      checkInput(input);
      return project(await ports.create(formFrom(null, input)));
    },

    update: async (id: string, patch: Partial<PluginSnippetInput>): Promise<void> => {
      const current = await find(id);
      refuseTeam(current, "changed");
      checkInput(patch);
      await ports.update(id, formFrom(current, patch));
    },

    delete: async (id: string): Promise<void> => {
      refuseTeam(await find(id), "deleted");
      await ports.remove(id);
    },
  };
}

export type SnippetsAPI = ReturnType<typeof createSnippetsAPI>;
