import type { PluginAPI } from "@/plugins/api";

export const MAX_CONTEXT_LINES = 200;
export const MAX_CONTEXT_CHARS = 16_000;
const SNAPSHOT_LINES = 200;

export interface ContextAttachment {
  source: "selection" | "snapshot";
  lineCount: number;
  connectionName: string;
  truncated: boolean;
}

export interface AttachedContext extends ContextAttachment {
  sessionId: string;
  text: string;
}

/** Keep the LAST lines — a failure is at the end of the output, not the start. */
function cap(text: string): { text: string; lineCount: number; truncated: boolean } {
  const lines = text.split("\n");
  let truncated = false;
  let kept = lines;
  if (kept.length > MAX_CONTEXT_LINES) {
    kept = kept.slice(-MAX_CONTEXT_LINES);
    truncated = true;
  }
  let out = kept.join("\n");
  if (out.length > MAX_CONTEXT_CHARS) {
    out = out.slice(-MAX_CONTEXT_CHARS);
    truncated = true;
  }
  return { text: out, lineCount: out.split("\n").length, truncated };
}

/**
 * Selection-first terminal context for the touchpoint: the user's selection if
 * there is one, otherwise a buffer snapshot. Returns null when there is nothing
 * to attach (better than an empty chip) or when the gated read is refused —
 * the touchpoint still opens the drawer, just without context.
 */
export function buildTerminalContext(
  api: Pick<PluginAPI, "terminal">,
  sessionId: string,
  connectionName: string,
): AttachedContext | null {
  try {
    const selection = api.terminal.readSelection(sessionId);
    const useSelection = selection.trim().length > 0;
    const raw = useSelection ? selection : api.terminal.readSnapshot(sessionId, SNAPSHOT_LINES);
    if (raw.trim().length === 0) return null;
    const { text, lineCount, truncated } = cap(raw);
    return {
      sessionId,
      connectionName,
      source: useSelection ? "selection" : "snapshot",
      text,
      lineCount,
      truncated,
    };
  } catch {
    return null;
  }
}

/** English by construction: this is prompt text for the model, not UI copy. */
export function formatContextBlock(ctx: AttachedContext): string {
  const label = ctx.source === "selection" ? "terminal selection" : "terminal buffer snapshot";
  const trunc = ctx.truncated ? ", truncated" : "";
  return `Attached from ${ctx.connectionName} (${label}, ${ctx.lineCount} lines${trunc}):\n\`\`\`\n${ctx.text}\n\`\`\``;
}
