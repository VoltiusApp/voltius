import { useEffect } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { claimWebglRenderer } from "@/utils/webglAddon";
import { suppressTerminalQueries } from "@/components/terminal/terminalQueries";
import { activateTerminal, disposeClosedTerminals, reattachTerminal, useTerminalMount, type CachedTerminal } from "@/components/terminal/terminalContainer";
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

// Cached like solo terminals: moving the tab into a split pane remounts the view.
interface GuestTerminal extends CachedTerminal {
  dispose: () => void;
}

const guestTerminals = new Map<string, GuestTerminal>();

useSessionStore.subscribe((state) => disposeClosedTerminals(guestTerminals, state.sessions));

function mountGuestTerminal(localSessionId: string, container: HTMLDivElement): GuestTerminal {
  const cached = guestTerminals.get(localSessionId);
  if (cached) {
    reattachTerminal(cached, container);
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
  const queryGuard = suppressTerminalQueries(term);

  claimWebglRenderer(term);

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
    queryGuard.dispose();
    term.dispose();
  };
  guestTerminals.set(localSessionId, entry);
  return entry;
}

export default function MultiplayerTerminalView({ localSessionId, active }: Props) {
  // No OSC 52: a guest's clipboard is written only by the guest's own action, never by the controller.
  const attach = useTerminalMount((container) => mountGuestTerminal(localSessionId, container), undefined, [localSessionId]);

  useEffect(() => {
    if (!active) return;
    const entry = guestTerminals.get(localSessionId);
    if (!entry) return;
    activateTerminal(entry);
    entry.fitAddon.fit();
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
