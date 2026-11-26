import { useEffect } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { claimWebglRenderer } from "@/utils/webglAddon";
import { suppressTerminalQueries } from "@/components/terminal/terminalQueries";
import { activateTerminal, disposeClosedTerminals, reattachTerminal, setTerminalVisible, useTerminalMount } from "@/components/terminal/terminalContainer";
import { notifyScrollListeners, relayedTerminals, type RelayedTerminal } from "@/hooks/useTerminal";
import { useThemeStore } from "@/stores/themeStore";
import { useSessionStore } from "@/stores/sessionStore";
import { attachGuestOutput, useTeamSessionStore } from "@/stores/teamSessionStore";
import { guestCanType } from "@/utils/multiplayerControl";
import { subscribeTerminalCursor, subscribeTerminalTheme, terminalOptionsFor } from "@/utils/terminalTheme";
import "@xterm/xterm/css/xterm.css";

interface Props {
  localSessionId: string;
  active?: boolean;
  visible?: boolean;
  /** Mobile: no scrollbar, and one-finger drags go to the gesture layer. */
  compact?: boolean;
}

useSessionStore.subscribe((state) => disposeClosedTerminals(relayedTerminals, state.sessions));

const encoder = new TextEncoder();

function typingConnection(localSessionId: string) {
  const state = useTeamSessionStore.getState().connections[localSessionId];
  return state && guestCanType(state) ? state.connection : null;
}

function sendGuestInput(localSessionId: string, data: string): void {
  typingConnection(localSessionId)?.sendInput(encoder.encode(data)).catch(() => {});
}

// Cached like solo terminals: moving the tab into a split pane remounts the view.
function mountGuestTerminal(localSessionId: string, container: HTMLDivElement): RelayedTerminal {
  const cached = relayedTerminals.get(localSessionId);
  if (cached) {
    reattachTerminal(cached, container);
    return cached;
  }

  const activeTheme = useThemeStore.getState().getActiveTheme();
  const term = new Terminal(terminalOptionsFor(activeTheme));

  const fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(container);
  const queryGuard = suppressTerminalQueries(term);

  claimWebglRenderer(term);

  const entry: RelayedTerminal = {
    terminal: term,
    fitAddon,
    clip: null,
    acceptsInput: () => typingConnection(localSessionId) !== null,
    send: (data) => sendGuestInput(localSessionId, data),
    dispose: () => {},
  };
  term.attachCustomKeyEventHandler((e) => entry.clip?.handleKeyEvent(e) ?? true);

  const onDataDispose = term.onData(entry.send);
  const onScrollDispose = term.onScroll(notifyScrollListeners);

  // Fit before replaying held output so the snapshot lands at the real size.
  fitAddon.fit();
  const detachOutput = attachGuestOutput(localSessionId, (data) => term.write(data));

  entry.dispose = () => {
    detachOutput();
    onDataDispose.dispose();
    onScrollDispose.dispose();
    queryGuard.dispose();
    term.dispose();
  };
  relayedTerminals.set(localSessionId, entry);
  return entry;
}

export default function MultiplayerTerminalView({ localSessionId, active, visible = true, compact }: Props) {
  // No OSC 52: a guest's clipboard is written only by the guest's own action, never by the controller.
  const attach = useTerminalMount((container) => mountGuestTerminal(localSessionId, container), undefined, [localSessionId]);

  useEffect(() => {
    const entry = relayedTerminals.get(localSessionId);
    if (entry) setTerminalVisible(entry, visible);
  }, [visible, localSessionId]);

  useEffect(() => {
    if (!active) return;
    const entry = relayedTerminals.get(localSessionId);
    if (!entry) return;
    activateTerminal(entry);
    entry.fitAddon.fit();
  }, [active, localSessionId]);

  // Live theme updates
  useEffect(() => {
    return subscribeTerminalTheme(() => {
      const entry = relayedTerminals.get(localSessionId);
      return { term: entry?.terminal, fit: entry?.fitAddon };
    });
  }, [localSessionId]);

  // Live cursor style/blink updates
  useEffect(() => {
    return subscribeTerminalCursor(() => relayedTerminals.get(localSessionId)?.terminal);
  }, [localSessionId]);

  return (
    <div className={`flex-1 min-h-0 flex flex-col${compact ? " terminal-compact" : ""}`}>
      <div
        ref={attach}
        className="flex-1 pl-[14px]"
      />
    </div>
  );
}
