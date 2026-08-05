import { useEffect } from "react";
import { useUIStore } from "@/stores/uiStore";
import { usePluginStore } from "@/stores/pluginStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { matchShortcut } from "@/stores/shortcutStore";
import { useHistoryStore } from "@/stores/historyStore";
import { openTerminalSearch, getTerminalSearchController } from "@/hooks/useTerminal";

const CLIPBOARD_TABS = new Set(["hosts", "keychain", "port-forwarding", "snippets"]);

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
        const { settingsOpen, settingsSection, setSettingsOpen, openSettings } = useUIStore.getState();
        if (settingsOpen && settingsSection === "shortcuts") {
          setSettingsOpen(false);
        } else {
          openSettings("shortcuts");
        }
        return;
      }

      if (matchShortcut("themes", e)) {
        e.preventDefault();
        const { settingsOpen, setSettingsOpen } = useUIStore.getState();
        setSettingsOpen(!settingsOpen);
        return;
      }

      // Ctrl+F: always prevent the native webview find dialog.
      // If the right panel is open on a section with a search bar, focus that
      // instead. Otherwise open the in-terminal search widget (when the terminal
      // canvas itself has focus, useTerminal's attachCustomKeyEventHandler
      // handles it instead).
      if (matchShortcut("terminal-search", e)) {
        e.preventDefault();
        const { rightPanelOpen, rightPanelSection, activeNav } = useUIStore.getState();
        const BUILTIN_SEARCHABLE_SECTIONS = ["snippets", "history"];
        // Not keyed by a literal plugin section id — a plugin opts in via
        // providesPanelSearch so a squatted id can't inherit the Ctrl+F wiring.
        const isPluginSectionSearchable = rightPanelSection.startsWith("plugin:") &&
          usePluginStore.getState().rightPanelSections.get(rightPanelSection.slice("plugin:".length))?.providesPanelSearch === true;
        if (rightPanelOpen && (BUILTIN_SEARCHABLE_SECTIONS.includes(rightPanelSection) || isPluginSectionSearchable)) {
          window.dispatchEvent(new CustomEvent("voltius:focus-panel-search"));
        } else if (activeNav === "terminal") {
          const activeId = useSessionStore.getState().activeSessionId;
          if (activeId) openTerminalSearch(activeId);
        }
        return;
      }

      // Ctrl+G / Shift+Ctrl+G: always prevent the native webview find-next dialog.
      // When the terminal search widget is open, drive it to next/prev result.
      if (e.ctrlKey && !e.altKey && (e.key === "g" || e.key === "G")) {
        e.preventDefault();
        if (useUIStore.getState().activeNav === "terminal") {
          const activeId = useSessionStore.getState().activeSessionId;
          if (activeId) {
            const ctrl = getTerminalSearchController(activeId);
            if (ctrl?.getSnapshot().open) {
              if (e.shiftKey) ctrl.prev();
              else ctrl.next();
            }
          }
        }
        return;
      }

      if (isInput) return;

      // Vault tabs only. In the terminal Ctrl+C must stay SIGINT.
      if (CLIPBOARD_TABS.has(useUIStore.getState().activeNav)) {
        // A live text selection owns Ctrl+C: copying a hostname out of a card
        // must reach the OS clipboard, not put the card on the vault clipboard.
        const hasTextSelection = !(window.getSelection()?.isCollapsed ?? true);
        for (const [id, event] of [
          ["copy", "voltius:clipboard-copy"],
          ["cut", "voltius:clipboard-cut"],
          ["paste", "voltius:clipboard-paste"],
        ] as const) {
          if (matchShortcut(id, e)) {
            if (id === "copy" && hasTextSelection) return;
            e.preventDefault();
            window.dispatchEvent(new CustomEvent(event));
            return;
          }
        }
      }

      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === "a") {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent("voltius:select-all"));
        return;
      }

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

      if (matchShortcut("history", e)) {
        e.preventDefault();
        useUIStore.getState().toggleRightPanel("history");
        return;
      }

      if (matchShortcut("snippets", e)) {
        e.preventDefault();
        useUIStore.getState().toggleRightPanel("snippets");
        return;
      }

      if (matchShortcut("panel-themes", e)) {
        e.preventDefault();
        useUIStore.getState().toggleRightPanel("themes");
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
