import type { TerminalSession } from "@/types";
import { getPaneSessionIds, type SplitTab } from "@/stores/layoutStore";

export type TitlebarItem =
  | { key: string; type: "session"; session: TerminalSession }
  | { key: string; type: "split"; tab: SplitTab }
  | { key: string; type: "stack"; connectionId: string; members: TerminalSession[] };

type ConnectionOf = (sessionId: string) => string | undefined;

export const stackKey = (connectionId: string) => `stack:${connectionId}`;

const sessionIdOf = (key: string) => (key.startsWith("session:") ? key.slice("session:".length) : null);

export function buildTitlebarItems(
  orderedKeys: string[],
  sessions: TerminalSession[],
  splitTabs: SplitTab[],
  grouped: boolean,
): TitlebarItem[] {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const tabById = new Map(splitTabs.map((tab) => [tab.id, tab]));
  const membersByHost = new Map<string, TerminalSession[]>();
  if (grouped) {
    for (const key of orderedKeys) {
      const session = sessionById.get(sessionIdOf(key) ?? "");
      if (session) membersByHost.set(session.connectionId, [...(membersByHost.get(session.connectionId) ?? []), session]);
    }
  }
  const items: TitlebarItem[] = [];
  const emitted = new Set<string>();
  for (const key of orderedKeys) {
    if (key.startsWith("split:")) {
      const tab = tabById.get(key.slice("split:".length));
      if (tab) items.push({ key, type: "split", tab });
      continue;
    }
    const session = sessionById.get(sessionIdOf(key) ?? "");
    if (!session) continue;
    const members = membersByHost.get(session.connectionId);
    if (!members || members.length < 2) {
      items.push({ key, type: "session", session });
      continue;
    }
    if (emitted.has(session.connectionId)) continue;
    emitted.add(session.connectionId);
    items.push({ key: stackKey(session.connectionId), type: "stack", connectionId: session.connectionId, members });
  }
  return items;
}

export function stackMemberKeys(order: string[], key: string, connectionOf: ConnectionOf): string[] {
  if (!key.startsWith("stack:")) return [key];
  const connectionId = key.slice("stack:".length);
  return order.filter((candidate) => {
    const id = sessionIdOf(candidate);
    return id !== null && connectionOf(id) === connectionId;
  });
}

export function resolveTitlebarTarget(
  order: string[],
  targetKey: string | null,
  placement: "before" | "after",
  connectionOf: ConnectionOf,
): string | null {
  if (!targetKey) return null;
  const keys = stackMemberKeys(order, targetKey, connectionOf);
  return (placement === "before" ? keys[0] : keys[keys.length - 1]) ?? null;
}

export function stackMemberLabels(members: TerminalSession[]): Map<string, { label: string; number: number }> {
  const labels = new Map<string, { label: string; number: number }>();
  let untitled = 0;
  for (const member of members) {
    if (member.title) { labels.set(member.id, { label: member.title, number: 0 }); continue; }
    untitled += 1;
    labels.set(member.id, { label: untitled === 1 ? member.connectionName : `${member.connectionName} (${untitled})`, number: untitled });
  }
  return labels;
}

const STATUS_RANK: Record<TerminalSession["status"], number> = { error: 3, connecting: 2, disconnected: 1, connected: 0 };

export function worstStatus(members: TerminalSession[]): TerminalSession["status"] {
  return members.reduce<TerminalSession["status"]>(
    (worst, member) => (STATUS_RANK[member.status] > STATUS_RANK[worst] ? member.status : worst),
    "connected",
  );
}

export function shownMember(members: TerminalSession[], activeSessionId: string | null, lastActive: string | undefined): TerminalSession {
  return members.find((member) => member.id === activeSessionId)
    ?? members.find((member) => member.id === lastActive)
    ?? members[0];
}

export function hostSessionsInOrder(
  orderedKeys: string[],
  sessions: TerminalSession[],
  splitTabs: SplitTab[],
  connectionId: string,
): { session: TerminalSession; splitTabId: string | null }[] {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const rows: { session: TerminalSession; splitTabId: string | null }[] = [];
  for (const key of orderedKeys) {
    if (key.startsWith("split:")) {
      const tab = splitTabs.find((candidate) => `split:${candidate.id}` === key);
      for (const id of tab ? getPaneSessionIds(tab.root) : []) {
        const session = sessionById.get(id);
        if (session?.connectionId === connectionId) rows.push({ session, splitTabId: tab!.id });
      }
      continue;
    }
    const session = sessionById.get(sessionIdOf(key) ?? "");
    if (session?.connectionId === connectionId) rows.push({ session, splitTabId: null });
  }
  return rows;
}
