import { useEffect } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { matchShortcut } from "@/stores/shortcutStore";
import { useHistoryStore } from "@/stores/historyStore";

export function useKeyboard() {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tag = target.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;

      if (matchShortcut("omni", e)) {
        e.preventDefault();
        useUIStore.getState().setOmniOpen(true);
        return;
      }

      if (matchShortcut("shortcuts", e)) {
        e.preventDefault();
        useUIStore.getState().setShortcutsOpen(!useUIStore.getState().shortcutsOpen);
        return;
      }

      if (matchShortcut("themes", e)) {
        e.preventDefault();
        const { settingsOpen, setSettingsOpen, setSettingsSection } = useUIStore.getState();
        if (settingsOpen) {
          setSettingsOpen(false);
        } else {
          setSettingsSection("appearance");
          setSettingsOpen(true);
        }
        return;
      }

      if (isInput) return;

      if (matchShortcut("undo", e)) {
        e.preventDefault();
        const { canUndo, undo } = useHistoryStore.getState();
        if (canUndo) undo();
        return;
      }

      if (matchShortcut("redo", e)) {
        e.preventDefault();
        const { canRedo, redo } = useHistoryStore.getState();
        if (canRedo) redo();
        return;
      }

      if (matchShortcut("delete", e)) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("voltius:delete"));
        return;
      }

      if (matchShortcut("sidebar", e)) {
        e.preventDefault();
        useUIStore.getState().toggleSidebar();
        return;
      }

      if (matchShortcut("new-tab", e)) {
        e.preventDefault();
        useUIStore.getState().setActiveNav("hosts");
        return;
      }

      if (matchShortcut("close-tab", e)) {
        e.preventDefault();
        const { activeSessionId, disconnect, removeSession, sessions } =
          useSessionStore.getState();
        if (activeSessionId) {
          const session = sessions.find((s) => s.id === activeSessionId);
          // Clean up any active multiplayer connection first
          const mpConn = useTeamSessionStore.getState().connections[activeSessionId];
          if (mpConn) {
            if (mpConn.role === "host") {
              useTeamSessionStore.getState().stopSharing(activeSessionId).catch(() => {});
            } else {
              useTeamSessionStore.getState().leaveSession(activeSessionId);
            }
          }
          if (session?.status === "connected" || session?.status === "connecting") {
            disconnect(activeSessionId);
          } else {
            removeSession(activeSessionId);
          }
        }
        return;
      }

      if (matchShortcut("next-tab", e)) {
        e.preventDefault();
        const { sessions, activeSessionId, setActive } = useSessionStore.getState();
        if (sessions.length > 1 && activeSessionId) {
          const idx = sessions.findIndex((s) => s.id === activeSessionId);
          const next = sessions[(idx + 1) % sessions.length];
          setActive(next.id);
        }
        return;
      }

      if (matchShortcut("prev-tab", e)) {
        e.preventDefault();
        const { sessions, activeSessionId, setActive } = useSessionStore.getState();
        if (sessions.length > 1 && activeSessionId) {
          const idx = sessions.findIndex((s) => s.id === activeSessionId);
          const prev = sessions[(idx - 1 + sessions.length) % sessions.length];
          setActive(prev.id);
        }
        return;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
