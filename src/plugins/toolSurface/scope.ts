import type { PluginAPI } from "@/plugins/api";

/**
 * Tools that act on a filesystem path.
 *
 * These must never take a `tool`-grain grant: "always allow delete_path on this
 * host" authorises deleting ANY path there, which is the same blanket authority
 * the exact grain exists to deny a shell command. They are keyed on the exact
 * paths instead, so a grant covers the operation the user actually reviewed.
 *
 * Any new tool taking a path MUST be added here, or it defaults to tool-grain.
 */
/** Every tool that addresses a filesystem target, mutating or not. */
export const FILE_TOOLS = new Set([
  "list_files",
  "stat_file",
  "read_file",
  "make_dir",
  "rename_path",
  "delete_path",
  "write_file",
  "transfer_file",
]);

/**
 * Tools that name a connection directly rather than reaching one through a
 * session. Any new tool taking a `connectionId` MUST be added here, or its
 * audit rows carry the consumer's fallback scope instead of the real target.
 */
export const CONNECTION_TOOLS = new Set([
  "connection_get",
  "connection_update",
  "connection_delete",
  "open_session",
  "key_add_to_host",
]);

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
    if (CONNECTION_TOOLS.has(tool)) {
      // key_add_to_host's schema is snake_case (connection_id); every other
      // member of this set is camelCase (connectionId). Read both.
      connectionId = (args.connectionId ?? args.connection_id) as string | undefined;
    } else if (FILE_TOOLS.has(tool)) {
      // A file tool names its target directly rather than via a session. For a
      // transfer the SOURCE is the scope: it is the side whose data leaves, and
      // scoping on the destination would let a grant on a host the user trusts
      // authorise reading one they did not pick.
      connectionId = (tool === "transfer_file" ? args.fromTarget : args.target) as string | undefined;
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
