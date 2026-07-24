import type { PluginAPI } from "@/plugins/api";

export function allowlistKey(tool: string, args: Record<string, unknown>): string {
  if (tool === "run_command") {
    const cmd = String(args.command ?? "").trim();
    return cmd.split(/\s+/)[0] || "run_command";
  }
  return tool;
}

// `!` is included because interactive bash/zsh perform history expansion on
// it (e.g. `df -h !sudo`, `df !!`, `df !-1` expand to prior history entries
// before the shell ever consults the tool's own argument list) — a command
// that reads as an innocuous allowlisted invocation can execute something
// else entirely once the interactive PTY expands it.
const SHELL_METACHARACTERS = /[;&|`$()<>\\!\r\n]/;

/** Any tool whose arguments include a shell command string. Any new tool
 * that takes a shell command MUST be added here, or `isAllowlistable` will
 * default to treating it as safe to allowlist regardless of its content. */
export const COMMAND_CARRYING_TOOLS = new Set(["run_command"]);

/** True if `s` contains a shell metacharacter that could change how a
 * command behaves outside of the exact approved invocation. Shared by
 * `isAllowlistable` and the allowlist store's own write-time guard so the
 * two checks can't drift apart. */
export function hasShellMetacharacter(s: string): boolean {
  return SHELL_METACHARACTERS.test(s);
}

export function isAllowlistable(tool: string, args: Record<string, unknown>): boolean {
  if (!COMMAND_CARRYING_TOOLS.has(tool)) return true;
  const cmd = String(args.command ?? "");
  return !hasShellMetacharacter(cmd);
}

/** Display sentinel used on a `PendingApproval` when `deriveHost` could not
 * resolve a host. Never a legitimate host string, so both the approval gate
 * and the card can test for it directly instead of drifting apart. */
export const UNKNOWN_HOST = "unknown host";

/**
 * Resolve the host a tool call would act on, or `null` if it cannot be
 * determined (unknown session, deleted connection, a lookup throwing, …).
 * `null` must never be treated as a real host by the caller — the allowlist
 * has to fail closed, not open, when the host is uncertain. A genuine local
 * session (real sessions carry the literal `connectionId: "local"`) is the
 * only case that legitimately returns `"local"`.
 */
export async function deriveHost(
  api: Pick<PluginAPI, "sessions" | "connections">,
  tool: string,
  args: Record<string, unknown>,
): Promise<string | null> {
  try {
    let connectionId: string | undefined;
    if (tool === "open_session") {
      connectionId = args.connectionId as string | undefined;
    } else {
      const sessionId = args.sessionId as string | undefined;
      const session = api.sessions.list().find((s) => s.id === sessionId);
      if (!session) return null; // unknown session — could not determine, do not fail open to "local"
      connectionId = session.connectionId;
    }
    if (!connectionId) return null;
    if (connectionId === "local") return "local"; // a genuine local-shell session
    const conn = (await api.connections.list()).find((c) => c.id === connectionId);
    return conn?.host ?? null; // connection not found — could not determine, do not fail open to "local"
  } catch {
    return null;
  }
}
