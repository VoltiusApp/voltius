import { useSessionStore } from "@/stores/sessionStore";
import { useSnippetRecentStore, type RecentTarget } from "@/stores/snippetRecentStore";
import { broadcastSnippetInject } from "@/services/snippets";
import { isRunnableSession } from "@/services/snippetRun";
import type { SnippetPendingInject } from "@/services/snippetRunCore";

/**
 * Inject the answer to a snippet variable prompt into its target sessions and
 * record the run in recents.
 *
 * The prompt is answered from the global modal, which outlives whichever
 * surface opened it — the session picker navigates to the terminal, so a
 * page-local modal would be unmounted before the user ever sees it.
 */
export async function injectPendingSnippet(
  pending: SnippetPendingInject,
  resolvedText: string,
  execute: boolean,
): Promise<void> {
  const all = useSessionStore.getState().sessions;
  const targets = pending.sessionIds.length > 0
    ? pending.sessionIds.map((id) => all.find((s) => s.id === id)).filter((s) => !!s)
    : all.filter(isRunnableSession).slice(0, 1);
  if (targets.length === 0) return;

  await Promise.all(
    targets.map((s) => broadcastSnippetInject(s.id, s.type, resolvedText, execute).catch(console.error)),
  );

  const recentTargets: RecentTarget[] = targets.map((s) => ({
    connectionId: s.connectionId,
    connectionName: s.connectionName,
    sessionType: s.type as RecentTarget["sessionType"],
    localShell: s.localShell,
  }));
  useSnippetRecentStore.getState().add({
    snippetId: pending.snippet.id, targets: recentTargets, execute, timestamp: Date.now(),
  });
}
