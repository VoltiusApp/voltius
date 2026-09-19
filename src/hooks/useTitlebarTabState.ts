import { useEffect, useState } from "react";
import type { TFunction } from "i18next";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { buildSessionTabHandlers } from "@/components/layout/TitlebarTab";
import { useSessionStore } from "@/stores/sessionStore";
import type { TerminalSession } from "@/types";
import { stackGroupKey } from "@/utils/titlebarItems";

export function useLastActiveByHost(activeSession: TerminalSession | undefined, sessions: TerminalSession[]): Record<string, string> {
  const [byHost, setByHost] = useState<Record<string, string>>({});

  useEffect(() => {
    const liveHosts = new Set(sessions.map(stackGroupKey));
    setByHost((m) => {
      const next: Record<string, string> = {};
      for (const [host, id] of Object.entries(m)) if (liveHosts.has(host)) next[host] = id;
      if (activeSession) next[stackGroupKey(activeSession)] = activeSession.id;
      const keys = Object.keys(next);
      const unchanged = keys.length === Object.keys(m).length && keys.every((k) => m[k] === next[k]);
      return unchanged ? m : next;
    });
  }, [activeSession?.id, sessions]);

  return byHost;
}

interface SessionTabHandlerDeps {
  t: TFunction;
  isRenaming: (kind: "session" | "split", id: string) => boolean;
  handleTabClick: (id: string) => void;
  handleTabClose: (e: React.MouseEvent, id: string) => void;
  startRenameFromLabel: (e: React.MouseEvent, isActive: boolean, target: { kind: "session"; id: string }) => void;
  setRenaming: (target: { kind: "session"; id: string } | null) => void;
  setMenuTarget: (target: { kind: "session"; id: string } | null) => void;
  setMenuExtras: (extras: ContextMenuItem[]) => void;
  openTabMenu: (e: React.MouseEvent) => void;
  endRename: (id: string | undefined) => void;
}

export function useSessionTabHandlers(deps: SessionTabHandlerDeps) {
  return buildSessionTabHandlers({
    t: deps.t,
    isRenaming: (id) => deps.isRenaming("session", id),
    activate: (id) => deps.handleTabClick(id),
    close: (e, id) => deps.handleTabClose(e, id),
    startRenameFromLabel: (e, isActive, id) => deps.startRenameFromLabel(e, isActive, { kind: "session", id }),
    startRename: (id) => deps.setRenaming({ kind: "session", id }),
    openMenu: (e, id, extras) => { deps.setMenuTarget({ kind: "session", id }); deps.setMenuExtras(extras); deps.openTabMenu(e); },
    commitRename: (id, name) => { useSessionStore.getState().renameSession(id, name); deps.endRename(id); },
    cancelRename: (id) => deps.endRename(id),
  });
}
