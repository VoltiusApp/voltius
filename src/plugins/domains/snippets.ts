import type { Snippet, SnippetFormData } from "@/types";
import type { RunTarget } from "@/services/sftpTarget";
import type { SequencePrompt, SequenceRunResult } from "@/services/snippetSequence";
import type { LeafStep } from "@/services/snippetFlatten";
import type { PluginSnippet, PluginSnippetInput, PluginSnippetRunResult, PluginSnippetTargetRef } from "../api";
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
  /** Resolve target references to the engine's RunTargets. `unknown` names the
   *  references that matched nothing, so the caller can refuse by name. */
  resolveTargets(refs: PluginSnippetTargetRef[]): { targets: RunTarget[]; unknown: string[] };
  /** The app's own sequence engine. Returns "prompting" when user variables are
   *  still unfilled after `variables` is applied. */
  run(
    snippet: Snippet,
    targets: RunTarget[],
    onPrompt: (p: SequencePrompt) => void,
    variables?: Record<string, string>,
  ): Promise<SequenceRunResult | "prompting">;
  /** Flatten nested snippets to leaf steps, for dry runs. */
  flatten(snippet: Snippet): { steps: LeafStep[]; errors: string[] };
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

/** Dry-run label. The engine labels real runs itself, from the session store;
 *  this one stays store-free so the domain remains headless-testable. */
const labelOf = (t: RunTarget): string =>
  t.kind === "connection" ? t.connection.name ?? t.connection.host : t.label ?? t.sessionId;

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

    run: async (input: {
      snippetId: string;
      targets: PluginSnippetTargetRef[];
      variables?: Record<string, string>;
      dryRun?: boolean;
    }): Promise<PluginSnippetRunResult> => {
      const snippet = await find(input.snippetId);
      const { targets, unknown } = ports.resolveTargets(input.targets ?? []);
      if (unknown.length > 0) throw new Error(`No session or connection for: ${unknown.join(", ")}`);
      if (targets.length === 0) throw new Error("No targets given");

      if (input.dryRun) {
        const flat = ports.flatten(snippet);
        return {
          targets: [],
          flatten_errors: flat.errors,
          opened_session_ids: [],
          steps: targets.map((t) => ({ label: labelOf(t), steps: flat.steps })),
        };
      }

      // The engine prompts for user variables it still lacks. There is no UI on
      // this path, so a prompt is a refusal naming what is missing — never a
      // modal nobody is there to answer.
      let missing: string[] = [];
      const outcome = await ports.run(
        snippet,
        targets,
        (p) => {
          // The prompt's initialValues already carry the caller's variables, so
          // a user var absent from them is one nobody supplied.
          missing = p.userVars.filter((v) => p.initialValues[v.name] === undefined).map((v) => v.name);
          if (missing.length === 0) missing = p.userVars.map((v) => v.name);
        },
        input.variables,
      );
      if (outcome === "prompting") {
        throw new Error(`Missing variables: ${missing.join(", ")}. Pass them in \`variables\`.`);
      }
      return {
        targets: outcome.targets.map((t) => ({ label: t.label, ok: t.ok, error: t.error })),
        flatten_errors: outcome.flattenErrors,
        opened_session_ids: outcome.openedSessionIds ?? [],
      };
    },
  };
}

export type SnippetsAPI = ReturnType<typeof createSnippetsAPI>;
