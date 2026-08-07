import { z } from "zod";
import type { PluginAPI } from "@/plugins/api";
import { buildCoreTools, type ToolSurfacePorts } from "@voltius/tools";

export interface McpTool {
  name: string;
  description: string;
  inputSchema: unknown;
  execute(args: Record<string, unknown>): Promise<unknown>;
}

/** Deliberately an explicit allowlist, not `risk === "auto"`: the auto tier
 *  also carries read_file and read_terminal, which reach arbitrary host files
 *  and terminal buffers. Voltius performs no per-call check here, so this
 *  slice ships the two pure listings only. */
const MCP_TOOLS = new Set(["list_connections", "list_sessions"]);

export function buildMcpTools(api: PluginAPI): McpTool[] {
  const ports: ToolSurfacePorts = {
    api,
    // The MCP client's own permission prompt is the gate; Voltius performs no
    // per-call check by construction. Unreachable while only auto-risk tools
    // are exposed, and deliberately not a prompt if that ever changes.
    approve: async ({ args }) => ({ approve: true, scope: "mcp", via: "granted", args }),
    audit: (scope, action, metadata, localMetadata) =>
      api.audit?.record?.(scope, action, { ...metadata, via: "mcp" }, localMetadata),
    owned: new Set<string>(),
  };
  return buildCoreTools(ports)
    .filter((t) => MCP_TOOLS.has(t.name))
    .map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: z.toJSONSchema(t.schema),
      execute: (args) => t.execute(args),
    }));
}

export function listToolDescriptors(tools: McpTool[]) {
  return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export async function callTool(
  tools: McpTool[],
  name: string,
  args: Record<string, unknown>,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { ok: false, error: `unknown tool "${name}"` };
  try {
    return { ok: true, result: await tool.execute(args) };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
