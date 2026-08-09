import { z } from "zod";
import type { McpToolContribution } from "@/plugins/api";

export interface RegisteredTool {
  pluginId: string;
  /** Namespaced, e.g. "docker__container_list". */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  schema: z.ZodType;
  mutating: boolean;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

const NAME_RE = /^[a-z0-9_]+$/;

const _byPlugin = new Map<string, RegisteredTool[]>();
const _listeners = new Set<() => void>();
let _version = 0;

/** A plugin id's tool prefix. Bundled ids carry a "plugin-" prefix that would
 *  otherwise show up in every tool name the model reads. */
export function namespaceFor(pluginId: string): string {
  return pluginId.replace(/^plugin-/, "");
}

export function contributionsVersion(): number {
  return _version;
}

export function onContributionsChanged(cb: () => void): () => void {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

function bump(): void {
  _version += 1;
  for (const cb of _listeners) cb();
}

/**
 * Validate and register a plugin's whole tool set. Everything is checked here,
 * at registration, rather than at call time: a tool that fails a check would
 * otherwise pass the entire unit suite and only die on a real call.
 *
 * All-or-nothing — a set with one bad tool registers none of them, so a plugin
 * can never end up half-contributed.
 */
export function registerContributions(
  pluginId: string,
  tools: McpToolContribution[],
): () => void {
  const ns = namespaceFor(pluginId);
  const owner = [..._byPlugin.keys()].find((id) => id !== pluginId && namespaceFor(id) === ns);
  if (owner) {
    throw new Error(`MCP tool namespace "${ns}" is already taken by plugin "${owner}"`);
  }

  const seen = new Set<string>();
  const built: RegisteredTool[] = tools.map((t) => {
    if (!NAME_RE.test(t.name)) {
      throw new Error(`invalid MCP tool name "${t.name}": expected /^[a-z0-9_]+$/`);
    }
    if (seen.has(t.name)) throw new Error(`duplicate MCP tool name "${t.name}"`);
    seen.add(t.name);
    if (!t.description.trim()) throw new Error(`MCP tool "${t.name}" needs a description`);

    const name = `${ns}__${t.name}`;
    let schema: z.ZodType;
    try {
      schema = z.fromJSONSchema(t.inputSchema as never) as z.ZodType;
    } catch (err) {
      throw new Error(
        `MCP tool "${t.name}" has an unusable inputSchema: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return {
      pluginId,
      name,
      description: t.description,
      inputSchema: t.inputSchema,
      schema,
      mutating: t.mutating !== false,
      execute: (args) => t.execute(args),
    };
  });

  const taken = new Set(listContributions().filter((r) => r.pluginId !== pluginId).map((r) => r.name));
  for (const r of built) {
    if (taken.has(r.name)) throw new Error(`MCP tool "${r.name}" is already registered`);
  }

  _byPlugin.set(pluginId, built);
  bump();
  return () => clearContributions(pluginId);
}

export function clearContributions(pluginId: string): void {
  if (_byPlugin.delete(pluginId)) bump();
}

export function listContributions(): RegisteredTool[] {
  return [..._byPlugin.values()].flat();
}

export function contributionsByPlugin(): Map<string, RegisteredTool[]> {
  return new Map(_byPlugin);
}
