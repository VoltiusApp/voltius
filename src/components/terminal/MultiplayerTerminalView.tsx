import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { attachTerminalClipboard } from "@/components/terminal/terminalClipboard";
import { useThemeStore } from "@/stores/themeStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { withFlagEmojiFallback } from "@/utils/emojiFont";
import "@xterm/xterm/css/xterm.css";

interface Props {
  localSessionId: string;
  active?: boolean;
}

export default function MultiplayerTerminalView({ localSessionId, active }: Props) {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);


  const attach = useCallback(
    (container: HTMLDivElement | null) => {
      if (!container || cleanupRef.current) return;
      containerRef.current = container;

      const activeTheme = useThemeStore.getState().getActiveTheme();
      const scrollback = useTerminalSettingsStore.getState().scrollbackLines;
      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: activeTheme.terminalFontSize,
        fontFamily: withFlagEmojiFallback(activeTheme.terminalFontFamily),
        scrollback,
        theme: activeTheme.terminal,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(container);

      try {
        term.loadAddon(new WebglAddon());
      } catch {
        // fallback to canvas
      }

      // Local clipboard parity with solo terminals (copy-on-select, smart Ctrl+C,
      // Ctrl+Shift+C, paste, right-click). No OSC 52: a guest's clipboard is never
      // written by the session controller — only by the guest's own action.
      const clip = attachTerminalClipboard(term, container);
      term.attachCustomKeyEventHandler((e) => {
        const r = clip.handleKeyEvent(e);
        return r != null ? r : true;
      });

      fitAddon.fit();
      termRef.current = term;
      fitRef.current = fitAddon;

      const encoder = new TextEncoder();
      const onDataDispose = term.onData((data) => {
        const state = useTeamSessionStore.getState().connections[localSessionId];
        if (!state) return;
        // Only send input when this user is the control holder
        if (state.role === "guest" && state.controlHolder === state.myUserId) {
          state.connection.sendInput(encoder.encode(data)).catch(() => {});
        }
      });

      const handleWindowResize = () => fitAddon.fit();
      window.addEventListener("resize", handleWindowResize);
      const resizeObserver = new ResizeObserver(() => fitAddon.fit());
      resizeObserver.observe(container);

      cleanupRef.current = () => {
        onDataDispose.dispose();
        clip.dispose();
        window.removeEventListener("resize", handleWindowResize);
        resizeObserver.disconnect();
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
        cleanupRef.current = null;
      };

      // Expose write function via store patch
      useTeamSessionStore.setState((s) => {
        const existing = s.connections[localSessionId];
        if (!existing) return s;
        return {
          connections: {
            ...s.connections,
            [localSessionId]: {
              ...existing,
              _termWrite: (data: Uint8Array) => term.write(data),
            },
          },
        };
      });
    },
    [localSessionId],
  );

  useEffect(() => {
    const unsubscribe = useTeamSessionStore.subscribe((state) => {
      const conn = state.connections[localSessionId];
      if (conn?._pendingOutput && termRef.current) {
        termRef.current.write(conn._pendingOutput);
      }
    });
    return unsubscribe;
  }, [localSessionId]);

  useEffect(() => {
    if (active) {
      termRef.current?.focus();
      fitRef.current?.fit();
    }
  }, [active]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  // Live theme updates
  useEffect(() => {
    return useThemeStore.subscribe((state) => {
      const term = termRef.current;
      const fit = fitRef.current;
      if (!term) return;
      const theme = state.getActiveTheme();
      term.options.theme = theme.terminal;
      term.options.fontFamily = withFlagEmojiFallback(theme.terminalFontFamily);
      if (term.options.fontSize !== theme.terminalFontSize) {
        term.options.fontSize = theme.terminalFontSize;
        fit?.fit();
      }
    });
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div
        ref={attach}
        className="flex-1 pl-[14px]"
      />
    </div>
  );
}
