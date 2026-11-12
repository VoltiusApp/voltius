import i18n from "@/i18n";
import { useSessionStore } from "@/stores/sessionStore";
import { useLayoutStore } from "@/stores/layoutStore";

export function useSessionLocked(sessionId: string): boolean {
  return useSessionStore((s) => s.sessions.some((x) => x.id === sessionId && x.locked === true));
}

export function useDismissBlockedReason(sessionId: string | undefined): string | undefined {
  const locked = useSessionLocked(sessionId ?? "");
  return locked ? i18n.t("layout.titleBar.lock.closeBlocked") : undefined;
}

export function useIsPinned(key: string): boolean {
  return useLayoutStore((s) => s.pinnedKeys.includes(key));
}
