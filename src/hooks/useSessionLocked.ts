import i18n from "@/i18n";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";
import { anyLocked } from "@/services/tabLock";

export function useSessionsLocked(sessionIds: string[]): boolean {
  return useSessionStore((s) => anyLocked(s.sessions, sessionIds));
}

export function useDismissBlockedReason(sessionId: string | undefined): string | undefined {
  const locked = useSessionsLocked(sessionId ? [sessionId] : []);
  return locked ? i18n.t("layout.titleBar.lock.closeBlocked") : undefined;
}

export function useIsPinned(key: string): boolean {
  return useLayoutStore((s) => s.pinnedKeys.includes(key));
}
