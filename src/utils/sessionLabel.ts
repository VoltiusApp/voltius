import type { SplitTab } from "@/stores/layoutStore";
import type { TerminalSession } from "@/types";

/** A tab name is a label, not a document: long enough to be useful, short
 * enough that the tab still reads as a tab. */
export const TAB_TITLE_MAX = 60;

/** What the user typed, ready to store. Blank input clears the name rather
 * than pinning an empty label over the connection it falls back to. */
export function normalizeTabTitle(raw: string | null | undefined): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed.slice(0, TAB_TITLE_MAX) : undefined;
}

/**
 * What a tab, pane header or drag ghost calls a session: the name the user gave
 * it, else the connection it opened. Renaming the connection upstream therefore
 * only moves the fallback — a custom title always wins.
 */
export function sessionLabel(session: Pick<TerminalSession, "connectionName" | "title">): string {
  return session.title ?? session.connectionName;
}

/**
 * A split tab's label. Its own name wins; without one it keeps deriving from
 * the active pane, so the label follows the user around the split.
 */
export function splitTabLabel(
  tab: Pick<SplitTab, "name">,
  activeSession: Pick<TerminalSession, "connectionName" | "title"> | undefined,
  fallback: string,
): string {
  return tab.name ?? (activeSession ? sessionLabel(activeSession) : fallback);
}
