import type { PluginAPI } from "@/plugins/api";

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

/** Display sentinel used on a `PendingApproval` when `deriveScope` could not
 * resolve a connection. Contains a space, so it can never collide with a real
 * connection id — both the approval gate and the card test for it directly
 * instead of drifting apart. */
export const UNKNOWN_SCOPE = "unknown connection";

/**
 * Resolve the connection a tool call would act on, as an allowlist scope:
 * a connection id, the literal `"local"`, or `null` when it cannot be
 * determined (unknown session, deleted or forged connection id, a lookup
 * throwing). `null` must never be treated as a real scope by the caller — the
 * allowlist has to fail closed, not open, when the target is uncertain.
 *
 * Scoping on the connection id rather than `conn.host` is deliberate: two
 * saved connections to one host under different users must not share an
 * allowlist bucket. Keying on the connection's *username* instead would fail
 * open, because an identity (or a per-session overlay) replaces the effective
 * user at connect time (`sessionStore.ts:369-377`), so a session authenticated
 * as root can carry a low-privilege connection's username.
 */
export async function deriveScope(
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
      if (!session) return null;
      connectionId = session.connectionId;
    }
    if (!connectionId) return null;
    if (connectionId === "local") return "local";
    // Existence check, not decoration: for `open_session` the id is
    // model-supplied, so without this a forged id would become a real scope.
    const conn = (await api.connections.list()).find((c) => c.id === connectionId);
    return conn?.id ?? null;
  } catch {
    return null;
  }
}
