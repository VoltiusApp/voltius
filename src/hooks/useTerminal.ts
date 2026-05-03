import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { sshSendInput, sshResize, onSshOutput, onSshClosed } from "@/services/ssh";
import { localSendInput, localResize, onLocalOutput, onLocalClosed } from "@/services/local";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface UseTerminalOptions {
  sessionId: string;
  sessionType: "ssh" | "local";
  onClosed?: () => void;
  /** If provided, input is only sent to the process when this returns true. */
  inputGate?: React.RefObject<() => boolean>;
  encoding?: string;
}

export function useTerminal({ sessionId, sessionType, onClosed, inputGate, encoding }: UseTerminalOptions) {
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  // Prevents resize/input calls from firing before the Tauri session exists.
  const connectedRef = useRef(sessionType === "local");

  useEffect(() => {
    if (sessionType !== "ssh") return;
    const onConnected = (state: ReturnType<typeof useSessionStore.getState>) => {
      const s = state.sessions.find((x) => x.id === sessionId);
      const nowConnected = s?.status === "connected";
      if (nowConnected && !connectedRef.current) {
        connectedRef.current = true;
        // Send actual PTY dimensions now that the Tauri session exists.
        const term = termRef.current;
        const fit = fitRef.current;
        if (fit && term) {
          fit.fit();
          sshResize(sessionId, term.cols, term.rows).catch(() => {});
        }
      } else if (!nowConnected) {
        connectedRef.current = false;
      }
    };
    onConnected(useSessionStore.getState());
    return useSessionStore.subscribe(onConnected);
  }, [sessionId, sessionType]);

  const attach = useCallback(
    (container: HTMLDivElement | null) => {
      if (!container || cleanupRef.current) return;
      containerRef.current = container;

      const activeTheme = useThemeStore.getState().getActiveTheme();
      const term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: activeTheme.terminalFontSize,
        fontFamily: activeTheme.terminalFontFamily,
        theme: activeTheme.terminal,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.loadAddon(new WebLinksAddon());

      const encoder = new TextEncoder();
      const decoder = encoding ? new TextDecoder(encoding) : null;

      // Intercept app shortcuts before xterm processes them
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        // Ctrl+Shift+P → always intercept (not used by shells)
        if (e.ctrlKey && e.shiftKey && e.key === "P") {
          if (e.type === "keydown") useUIStore.getState().setOmniOpen(true);
          return false;
        }
        // F1 → always intercept
        if (e.key === "F1") {
          if (e.type === "keydown") useUIStore.getState().setOmniOpen(true);
          return false;
        }
        // Ctrl+Shift+C → copy selection
        if (e.ctrlKey && e.shiftKey && e.key === "C") {
          if (e.type === "keydown") {
            const sel = term.getSelection();
            if (sel) navigator.clipboard.writeText(sel);
          }
          return false;
        }
        // Ctrl+Shift+V → paste from clipboard
        if (e.ctrlKey && e.shiftKey && e.key === "V") {
          e.preventDefault();
          if (e.type === "keydown") {
            navigator.clipboard.readText().then((text) => { if (text) term.paste(text); });
          }
          return false;
        }
        // Ctrl+C → copy selection if present, otherwise pass through as SIGINT
        if (e.ctrlKey && !e.shiftKey && e.key === "c") {
          const sel = term.getSelection();
          if (sel) {
            if (e.type === "keydown") navigator.clipboard.writeText(sel);
            return false;
          }
          return true;
        }
        // Ctrl+V → paste from clipboard
        if (e.ctrlKey && !e.shiftKey && e.key === "v") {
          e.preventDefault();
          if (e.type === "keydown") {
            navigator.clipboard.readText().then((text) => { if (text) term.paste(text); });
          }
          return false;
        }
        // Everything else (including Ctrl+K) passes to the terminal
        return true;
      });

      term.open(container);

      // Try WebGL renderer, fall back to canvas
      try {
        term.loadAddon(new WebglAddon());
      } catch {
        // WebGL not available, use default canvas renderer
      }

      termRef.current = term;
      fitRef.current = fitAddon;

      // Send user input
      const onDataDispose = term.onData((data) => {
        if (inputGate && !inputGate.current?.()) return;
        if (!connectedRef.current) return;
        if (sessionType === "local") {
          localSendInput(sessionId, encoder.encode(data));
        } else {
          sshSendInput(sessionId, encoder.encode(data));
        }
      });

      // Listen for output / closed events
      const unlistenPromises: Promise<UnlistenFn>[] = [];

      if (sessionType === "local") {
        unlistenPromises.push(
          onLocalOutput(sessionId, (data) => { term.write(decoder ? decoder.decode(data) : data); }),
        );
        unlistenPromises.push(
          onLocalClosed(sessionId, () => {
            term.write("\r\n\x1b[90m--- Session closed ---\x1b[0m\r\n");
            onClosed?.();
          }),
        );
      } else {
        unlistenPromises.push(
          onSshOutput(sessionId, (data) => { term.write(decoder ? decoder.decode(data) : data); }),
        );
        unlistenPromises.push(
          onSshClosed(sessionId, () => {
            term.write("\r\n\x1b[90m--- Connection closed ---\x1b[0m\r\n");
            onClosed?.();
          }),
        );
      }

      // Handle resize — registered before initial fit so the first fit immediately
      // propagates correct dimensions to the backend PTY (fixes nano/vim size on SSH).
      const onResizeDispose = term.onResize(({ cols, rows }) => {
        if (!connectedRef.current) return;
        if (sessionType === "local") {
          localResize(sessionId, cols, rows);
        } else {
          sshResize(sessionId, cols, rows);
        }
      });

      fitAddon.fit();

      // Window resize handler
      const handleWindowResize = () => {
        fitAddon.fit();
      };
      window.addEventListener("resize", handleWindowResize);

      // ResizeObserver for container size changes
      const resizeObserver = new ResizeObserver(() => {
        fitAddon.fit();
      });
      resizeObserver.observe(container);

      // Right-click → paste from clipboard
      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => { if (text) term.paste(text); });
      };
      container.addEventListener("contextmenu", handleContextMenu);

      // Cleanup function
      cleanupRef.current = () => {
        onDataDispose.dispose();
        onResizeDispose.dispose();
        window.removeEventListener("resize", handleWindowResize);
        container.removeEventListener("contextmenu", handleContextMenu);
        resizeObserver.disconnect();
        Promise.all(unlistenPromises).then((fns) => fns.forEach((fn) => fn()));
        term.dispose();
        termRef.current = null;
        fitRef.current = null;
        cleanupRef.current = null;
      };
    },
    [sessionId, sessionType, onClosed, encoding],
  );

  // Live theme updates (store changes)
  useEffect(() => {
    return useThemeStore.subscribe((state) => {
      const term = termRef.current;
      const fit = fitRef.current;
      if (!term) return;
      const theme = state.getActiveTheme();
      term.options.theme = theme.terminal;
      term.options.fontFamily = theme.terminalFontFamily;
      if (term.options.fontSize !== theme.terminalFontSize) {
        term.options.fontSize = theme.terminalFontSize;
        fit?.fit();
      }
    });
  }, []);

  // Live theme preview (editor preview, before saving)
  useEffect(() => {
    const handler = (e: Event) => {
      const term = termRef.current;
      const fit = fitRef.current;
      if (!term) return;
      const theme = (e as CustomEvent).detail;
      term.options.theme = theme.terminal;
      term.options.fontFamily = theme.terminalFontFamily;
      if (term.options.fontSize !== theme.terminalFontSize) {
        term.options.fontSize = theme.terminalFontSize;
        fit?.fit();
      }
    };
    window.addEventListener("theme-preview", handler);
    return () => window.removeEventListener("theme-preview", handler);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  const focus = useCallback(() => {
    termRef.current?.focus();
  }, []);

  const fit = useCallback(() => {
    const fitAddon = fitRef.current;
    const term = termRef.current;
    if (!fitAddon || !term) return;
    fitAddon.fit();
    // Force-send current dimensions — xterm suppresses onResize when cols/rows
    // haven't changed, which causes the PTY to stay at its initial 80x24 when
    // the session becomes active after connecting.
    if (!connectedRef.current) return;
    if (sessionType === "local") {
      localResize(sessionId, term.cols, term.rows);
    } else {
      sshResize(sessionId, term.cols, term.rows);
    }
  }, [sessionId, sessionType]);

  return { attach, focus, fit };
}
