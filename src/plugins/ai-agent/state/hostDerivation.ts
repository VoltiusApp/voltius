import type { PluginAPI } from "@/plugins/api";

export function allowlistKey(tool: string, args: Record<string, unknown>): string {
  if (tool === "run_command") {
    const cmd = String(args.command ?? "").trim();
    return cmd.split(/\s+/)[0] || "run_command";
  }
  return tool;
}

const SHELL_METACHARACTERS = /[;&|`$()<>\\\r\n]/;

export function isAllowlistable(tool: string, args: Record<string, unknown>): boolean {
  if (tool !== "run_command") return true;
  const cmd = String(args.command ?? "");
  return !SHELL_METACHARACTERS.test(cmd);
}

export async function deriveHost(
  api: Pick<PluginAPI, "sessions" | "connections">,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    let connectionId: string | undefined;
    if (tool === "open_session") {
      connectionId = args.connectionId as string | undefined;
    } else {
      const sessionId = args.sessionId as string | undefined;
      connectionId = api.sessions.list().find((s) => s.id === sessionId)?.connectionId;
    }
    if (!connectionId) return "local";
    const conn = (await api.connections.list()).find((c) => c.id === connectionId);
    return conn?.host || "local";
  } catch {
    return "local";
  }
}
