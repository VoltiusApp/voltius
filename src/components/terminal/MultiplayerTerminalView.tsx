import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { createWebglAddon } from "@/utils/webglAddon";
import { bindTerminalContainer, disposeClosedTerminals, type CachedTerminal } from "@/components/terminal/terminalContainer";
import { useThemeStore } from "@/stores/themeStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { getToggle } from "@/stores/toggleSettingsStore";
import { useSessionStore } from "@/stores/sessionStore";
import { attachGuestOutput, useTeamSessionStore } from "@/stores/teamSessionStore";
import { terminalFontStack } from "@/utils/fontStack";
import { clampTerminalLineHeight, subscribeTerminalCursor, subscribeTerminalTheme } from "@/utils/terminalTheme";
import "@xterm/xterm/css/xterm.css";

interface Props {
  localSessionId: string;
  active?: boolean;
}

// Guest xterms outlive their view, the way useTerminal caches solo terminals:
// moving the tab into a split pane remounts the view, and a fresh xterm there
// would wipe the screen and scrollback. Torn down once the tab is gone.
interface GuestTerminal extends CachedTerminal {
  dispose: () => void;
}

const guestTerminals = new Map<string, GuestTerminal>();

useSessionStore.subscribe((state) => disposeClosedTerminals(guestTerminals, state.sessions));

/** The session's cached terminal moved into `container`, or a new one opened there. */
function mountGuestTerminal(localSessionId: string, container: HTMLDivElement): GuestTerminal {
  const cached = guestTerminals.get(localSessionId);
  if (cached) {
    if (cached.terminal.element) container.appendChild(cached.terminal.element);
    cached.fitAddon.fit();
    return cached;
  }

  const activeTheme = useThemeStore.getState().getActiveTheme();
  const { scrollbackLines: scrollback, cursorStyle } = useTerminalSettingsStore.getState();
  const term = new Terminal({
    macOptionClickForcesSelection: true,
    cursorBlink: getToggle("cursor-blink"),
    cursorStyle,
    fontSize: activeTheme.terminalFontSize,
    lineHeight: clampTerminalLineHeight(activeTheme.terminalLineHeight),
    fontFamily: terminalFontStack(activeTheme.terminalFontFamily),
    scrollback,
    theme: activeTheme.terminal,
    allowProposedApi: true,
  });

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);

  try {
    term.loadAddon(createWebglAddon());
  } catch {
    // fallback to canvas
  }

  const entry: GuestTerminal = { terminal: term, fitAddon, clip: null, dispose: () => {} };
  term.attachCustomKeyEventHandler((e) => entry.clip?.handleKeyEvent(e) ?? true);

  const encoder = new TextEncoder();
  const onDataDispose = term.onData((data) => {
    const state = useTeamSessionStore.getState().connections[localSessionId];
    if (!state) return;
    // Only send input when this user is the control holder
    if (state.role === "guest" && state.controlHolder === state.myUserId) {
      state.connection.sendInput(encoder.encode(data)).catch(() => {});
    }
  });

  // Fit before replaying held output so the snapshot lands at the real size.
  fitAddon.fit();
  const detachOutput = attachGuestOutput(localSessionId, (data) => term.write(data));

  entry.dispose = () => {
    detachOutput();
    onDataDispose.dispose();
    term.dispose();
  };
  guestTerminals.set(localSessionId, entry);
  return entry;
}

export default function MultiplayerTerminalView({ localSessionId, active }: Props) {
  const mountCleanupRef = useRef<(() => void) | null>(null);

  const attach = useCallback(
    (container: HTMLDivElement | null) => {
      // React hands the ref a null on unmount and when localSessionId changes.
      if (!container) {
        mountCleanupRef.current?.();
        return;
      }
      if (mountCleanupRef.current) return;

      const entry = mountGuestTerminal(localSessionId, container);

      // Local clipboard parity with solo terminals (copy-on-select, smart Ctrl+C,
      // Ctrl+Shift+C, paste, right-click). No OSC 52: a guest's clipboard is never
      // written by the session controller — only by the guest's own action.
      const unbind = bindTerminalContainer(entry, container);
      mountCleanupRef.current = () => {
        unbind();
        mountCleanupRef.current = null;
      };
    },
    [localSessionId],
  );

  useEffect(() => {
    if (!active) return;
    const entry = guestTerminals.get(localSessionId);
    entry?.terminal.focus();
    entry?.fitAddon.fit();
  }, [active, localSessionId]);

  // Live theme updates
  useEffect(() => {
    return subscribeTerminalTheme(() => {
      const entry = guestTerminals.get(localSessionId);
      return { term: entry?.terminal, fit: entry?.fitAddon };
    });
  }, [localSessionId]);

  // Live cursor style/blink updates
  useEffect(() => {
    return subscribeTerminalCursor(() => guestTerminals.get(localSessionId)?.terminal);
  }, [localSessionId]);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        ref={attach}
        className="flex-1 pl-[14px]"
      />
    </div>
  );
}
