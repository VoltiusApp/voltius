import { buildMcpRegisterCommand } from "./registerCommand";

export type McpClientId = "claude-code" | "mcp-servers" | "vscode" | "opencode";

export const MCP_CLIENT_IDS: McpClientId[] = ["claude-code", "mcp-servers", "vscode", "opencode"];

/**
 * Builds the config snippet for the given client. JSON.stringify escapes the
 * path (backslashes, quotes) per the JSON spec — no manual shell-style quoting
 * belongs here; that's `buildMcpRegisterCommand`'s job for the CLI form only.
 */
export function buildMcpClientSnippet(clientId: McpClientId, exePath: string): string {
  switch (clientId) {
    case "claude-code":
      return buildMcpRegisterCommand(exePath);
    case "mcp-servers":
      return JSON.stringify(
        { mcpServers: { voltius: { command: exePath, args: ["mcp"] } } },
        null,
        2,
      );
    case "vscode":
      return JSON.stringify(
        { servers: { voltius: { type: "stdio", command: exePath, args: ["mcp"] } } },
        null,
        2,
      );
    case "opencode":
      return JSON.stringify(
        { mcp: { voltius: { type: "local", command: [exePath, "mcp"], enabled: true } } },
        null,
        2,
      );
  }
}
