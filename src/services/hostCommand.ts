import type { Connection } from "@/types";

export type HostCommandSlot = "pre" | "post";

export type HostCommand =
  | { kind: "inline"; text: string }
  | { kind: "snippet"; id: string }
  | null;

/** Snippet mode wins if both are somehow set, so the invariant is decided here
 *  rather than at each call site. */
export function resolveHostCommand(conn: Connection, slot: HostCommandSlot): HostCommand {
  const snippetId = slot === "pre" ? conn.pre_snippet_id : conn.post_snippet_id;
  if (snippetId) return { kind: "snippet", id: snippetId };

  const text = (slot === "pre" ? conn.pre_command : conn.post_command)?.trim();
  if (text) return { kind: "inline", text };

  return null;
}

/** What the backend should be handed for a slot. Snippet mode yields undefined:
 *  the sequence runs frontend-side once the session is up. */
export function inlineCommandForBackend(conn: Connection, slot: HostCommandSlot): string | undefined {
  const cmd = resolveHostCommand(conn, slot);
  return cmd?.kind === "inline" ? cmd.text : undefined;
}
