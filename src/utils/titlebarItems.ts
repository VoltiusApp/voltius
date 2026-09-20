import type { TerminalSession } from "@/types";
import { getPaneSessionIds, type SplitTab } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";

export type TitlebarItem =
  | { key: string; type: "session"; session: TerminalSession }
  | { key: string; type: "split"; tab: SplitTab }
  | { key: string; type: "stack"; groupKey: string; members: TerminalSession[] };

type GroupOf = (sessionId: string) => string | undefined;

export const stackKey = (groupKey: string) => `stack:${groupKey}`;

export const stackGroupKey = (session: TerminalSession) =>
  session.containerExec || session.connectionId === "serial-ephemeral" ? session.id : session.connectionId;

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
      if (!session) continue;
      const groupKey = stackGroupKey(session);
      membersByHost.set(groupKey, [...(membersByHost.get(groupKey) ?? []), session]);
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
    const groupKey = stackGroupKey(session);
    const members = membersByHost.get(groupKey);
    if (!members || members.length < 2) {
      items.push({ key, type: "session", session });
      continue;
    }
    if (emitted.has(groupKey)) continue;
    emitted.add(groupKey);
    items.push({ key: stackKey(groupKey), type: "stack", groupKey, members });
  }
  return items;
}

export function stackMemberKeys(order: string[], key: string, groupOf: GroupOf): string[] {
  if (!key.startsWith("stack:")) return [key];
  const groupKey = key.slice("stack:".length);
  return order.filter((candidate) => {
    const id = sessionIdOf(candidate);
    return id !== null && groupOf(id) === groupKey;
  });
}

export function resolveTitlebarTarget(
  order: string[],
  targetKey: string | null,
  placement: "before" | "after",
  groupOf: GroupOf,
): string | null {
  if (!targetKey) return null;
  const keys = stackMemberKeys(order, targetKey, groupOf);
  return (placement === "before" ? keys[0] : keys[keys.length - 1]) ?? null;
}

export function stackMemberLabels(members: TerminalSession[], openOrder: TerminalSession[]): Map<string, { label: string; number: number }> {
  const rank = new Map(openOrder.map((session, index) => [session.id, index]));
  const byOpenOrder = [...members].sort((a, b) => (rank.get(a.id) ?? openOrder.length) - (rank.get(b.id) ?? openOrder.length));
  const labels = new Map<string, { label: string; number: number }>();
  let untitled = 0;
  for (const member of byOpenOrder) {
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

export function stackHostName(members: TerminalSession[]): string | undefined {
  return (members.find((member) => !member.containerExec) ?? members[0])?.connectionName;
}

export function shownMember(members: TerminalSession[], activeSessionId: string | null, lastActive: string | undefined): TerminalSession | undefined {
  return members.find((member) => member.id === activeSessionId)
    ?? members.find((member) => member.id === lastActive)
    ?? members[0];
}

export function hostSessionsInOrder(
  orderedKeys: string[],
  sessions: TerminalSession[],
  splitTabs: SplitTab[],
  groupKey: string,
): { session: TerminalSession; splitTabId: string | null }[] {
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const rows: { session: TerminalSession; splitTabId: string | null }[] = [];
  for (const key of orderedKeys) {
    if (key.startsWith("split:")) {
      const tab = splitTabs.find((candidate) => `split:${candidate.id}` === key);
      for (const id of tab ? getPaneSessionIds(tab.root) : []) {
        const session = sessionById.get(id);
        if (session && stackGroupKey(session) === groupKey) rows.push({ session, splitTabId: tab!.id });
      }
      continue;
    }
    const session = sessionById.get(sessionIdOf(key) ?? "");
    if (session && stackGroupKey(session) === groupKey) rows.push({ session, splitTabId: null });
  }
  return rows;
}

export function visibleTitlebarKeys(sessions: TerminalSession[], splitTabs: SplitTab[]): string[] {
  const splitIds = new Set(splitTabs.flatMap((tab) => getPaneSessionIds(tab.root)));
  return [
    ...splitTabs.map((tab) => `split:${tab.id}`),
    ...sessions.filter((session) => !splitIds.has(session.id)).map((session) => `session:${session.id}`),
  ];
}

export function titlebarGroupOf(sessionId: string): string | undefined {
  const session = useSessionStore.getState().sessions.find((candidate) => candidate.id === sessionId);
  return session && stackGroupKey(session);
}

export function titlebarKeyGroupOf(key: string): string | undefined {
  const id = sessionIdOf(key);
  return id === null ? undefined : titlebarGroupOf(id);
}
