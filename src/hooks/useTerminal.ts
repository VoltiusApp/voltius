import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { open as openUrl } from "@tauri-apps/plugin-shell";
import { sshSendInput, sshResize, onSshOutput, onSshClosed } from "@/services/ssh";
import { localSendInput, localResize, onLocalOutput, onLocalClosed } from "@/services/local";
import { serialWrite, onSerialOutput, onSerialClosed } from "@/services/serial";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { matchShortcut } from "@/stores/shortcutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { findLeaf, getPaneSessionIds, useLayoutStore } from "@/stores/layoutStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { useCommandHistoryStore } from "@/stores/commandHistoryStore";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface UseTerminalOptions {
  sessionId: string;
  sessionType: "ssh" | "local" | "serial";
  onClosed?: () => void;
  /** If provided, input is only sent to the process when this returns true. */
  inputGate?: React.RefObject<() => boolean>;
  encoding?: string;
  onResize?: (cols: number, rows: number) => void;
}

function sendSessionInput(sessionId: string, sessionType: "ssh" | "local" | "serial", data: Uint8Array) {
  if (sessionType === "local") {
    localSendInput(sessionId, data);
  } else if (sessionType === "serial") {
    serialWrite(sessionId, data).catch(() => {});
  } else {
    sshSendInput(sessionId, data);
  }
}

function isHttpUrl(uri: string) {
  try {
    const url = new URL(uri);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function focusPaneInDirection(direction: "left" | "right" | "up" | "down") {
  const layout = useLayoutStore.getState();
  if (!layout.activePaneId) return;
  const activeEl = document.querySelector<HTMLElement>(`[data-pane-id="${layout.activePaneId}"]`);
  if (!activeEl) return;
  const activeRect = activeEl.getBoundingClientRect();
  const activeCenter = { x: activeRect.left + activeRect.width / 2, y: activeRect.top + activeRect.height / 2 };
  const candidates = Array.from(document.querySelectorAll<HTMLElement>("[data-pane-id]")).filter((el) => el.dataset.paneId !== layout.activePaneId);

  let best: { paneId: string; distance: number } | null = null;
  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    const dx = center.x - activeCenter.x;
    const dy = center.y - activeCenter.y;
    if (direction === "left" && dx >= 0) continue;
    if (direction === "right" && dx <= 0) continue;
    if (direction === "up" && dy >= 0) continue;
    if (direction === "down" && dy <= 0) continue;
    const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
    const secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    const distance = primary * primary + secondary * secondary * 2;
    if (!best || distance < best.distance) best = { paneId: el.dataset.paneId!, distance };
  }

  if (!best) return;
  const leaf = findLeaf(layout.root, best.paneId);
  if (!leaf) return;
  layout.setActivePane(leaf.id);
  useSessionStore.getState().setActive(leaf.sessionId);
}

// ─── Module-level terminal cache ──────────────────────────────────────────────
// Xterm instances are keyed by sessionId and survive component remounts.
// This prevents the scrollback buffer from being wiped when pane layouts change.

export interface TerminalSearchSnapshot {
  open: boolean;
  query: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
  resultIndex: number;  // -1 when no active match
  resultCount: number;
  invalidRegex: boolean;
  /** Increments on every open() call so the input can re-focus + select-all even when already open. */
  focusTick: number;
}

interface SearchState {
  snapshot: TerminalSearchSnapshot;
  subscribers: Set<() => void>;
}

type CacheEntry = {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  search: SearchState;
  sessionType: "ssh" | "local" | "serial";
  connectedRef: { current: boolean };
  onClosedRef: { current: (() => void) | undefined };
  onResizeRef: { current: ((cols: number, rows: number) => void) | undefined };
  dispose: () => void; // full teardown, called only when the session is deleted
};

const terminalCache = new Map<string, CacheEntry>();

// ─── Search controller (module-level, callable from anywhere) ────────────────

const EMPTY_SNAPSHOT: TerminalSearchSnapshot = {
  open: false,
  query: "",
  caseSensitive: false,
  wholeWord: false,
  regex: false,
  resultIndex: -1,
  resultCount: 0,
  invalidRegex: false,
  focusTick: 0,
};

function notifySearch(entry: CacheEntry) {
  entry.search.subscribers.forEach((fn) => fn());
}

function searchDecorations() {
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--t-accent").trim() || "#6366f1";
  return {
    matchBackground: accent + "55",
    matchBorder: accent,
    matchOverviewRuler: accent,
    activeMatchBackground: accent,
    activeMatchBorder: accent,
    activeMatchColorOverviewRuler: accent,
  };
}

function isRegexValid(pattern: string): boolean {
  try { new RegExp(pattern); return true; } catch { return false; }
}

function runSearch(entry: CacheEntry, direction: "next" | "prev", incremental: boolean) {
  const s = entry.search.snapshot;
  if (!s.query) {
    entry.searchAddon.clearDecorations();
    entry.search.snapshot = { ...s, resultIndex: -1, resultCount: 0, invalidRegex: false };
    notifySearch(entry);
    return;
  }
  if (s.regex && !isRegexValid(s.query)) {
    entry.searchAddon.clearDecorations();
    entry.search.snapshot = { ...s, resultIndex: -1, resultCount: 0, invalidRegex: true };
    notifySearch(entry);
    return;
  }
  if (s.invalidRegex) {
    entry.search.snapshot = { ...s, invalidRegex: false };
  }
  const opts: ISearchOptions = {
    regex: s.regex,
    caseSensitive: s.caseSensitive,
    wholeWord: s.wholeWord,
    incremental,
    decorations: searchDecorations(),
  };
  if (direction === "next") entry.searchAddon.findNext(s.query, opts);
  else entry.searchAddon.findPrevious(s.query, opts);
}

export interface TerminalSearchController {
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => TerminalSearchSnapshot;
  open: () => void;
  close: () => void;
  setQuery: (q: string) => void;
  next: () => void;
  prev: () => void;
  toggleCaseSensitive: () => void;
  toggleWholeWord: () => void;
  toggleRegex: () => void;
}

export function getTerminalSearchController(sessionId: string): TerminalSearchController | null {
  const entry = terminalCache.get(sessionId);
  if (!entry) return null;
  const sub = entry.search.subscribers;
  return {
    subscribe: (fn) => { sub.add(fn); return () => { sub.delete(fn); }; },
    getSnapshot: () => entry.search.snapshot,
    open: () => {
      const cur = entry.search.snapshot;
      const wasOpen = cur.open;
      // Only pre-fill from a single-line terminal selection on the first open.
      const selection = entry.terminal.getSelection();
      const initialQuery =
        !wasOpen && selection && !selection.includes("\n") ? selection : cur.query;
      entry.search.snapshot = {
        ...cur,
        open: true,
        query: initialQuery,
        focusTick: cur.focusTick + 1,
      };
      notifySearch(entry);
      if (!wasOpen && initialQuery && initialQuery !== cur.query) runSearch(entry, "next", true);
    },
    close: () => {
      entry.searchAddon.clearDecorations();
      entry.search.snapshot = { ...entry.search.snapshot, open: false, resultIndex: -1, resultCount: 0, invalidRegex: false };
      notifySearch(entry);
      // Return focus to the terminal
      entry.terminal.focus();
    },
    setQuery: (q) => {
      entry.search.snapshot = { ...entry.search.snapshot, query: q };
      runSearch(entry, "next", true);
    },
    next: () => runSearch(entry, "next", false),
    prev: () => runSearch(entry, "prev", false),
    toggleCaseSensitive: () => {
      entry.search.snapshot = { ...entry.search.snapshot, caseSensitive: !entry.search.snapshot.caseSensitive };
      runSearch(entry, "next", true);
    },
    toggleWholeWord: () => {
      entry.search.snapshot = { ...entry.search.snapshot, wholeWord: !entry.search.snapshot.wholeWord };
      runSearch(entry, "next", true);
    },
    toggleRegex: () => {
      entry.search.snapshot = { ...entry.search.snapshot, regex: !entry.search.snapshot.regex };
      runSearch(entry, "next", true);
    },
  };
}

/** Open the search widget for a given session (no-op if the session has no cached terminal yet). */
export function openTerminalSearch(sessionId: string): void {
  getTerminalSearchController(sessionId)?.open();
}

// Auto-cleanup when sessions are removed from the store
useSessionStore.subscribe((state) => {
  const currentIds = new Set(state.sessions.map((s) => s.id));
  for (const [id, entry] of terminalCache) {
    if (!currentIds.has(id)) {
      entry.dispose();
      terminalCache.delete(id);
    }
  }

  // Update connectedRef and trigger PTY resize when SSH sessions connect
  for (const [id, entry] of terminalCache) {
    if (entry.sessionType !== "ssh") continue;
    const session = state.sessions.find((s) => s.id === id);
    const nowConnected = session?.status === "connected";
    if (nowConnected && !entry.connectedRef.current) {
      entry.connectedRef.current = true;
      entry.fitAddon.fit();
      sshResize(id, entry.terminal.cols, entry.terminal.rows).catch(() => {});
    } else if (!nowConnected) {
      entry.connectedRef.current = false;
    }
  }
});

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useTerminal({ sessionId, sessionType, onClosed, inputGate, encoding, onResize }: UseTerminalOptions) {
  const mountCleanupRef = useRef<(() => void) | null>(null);

  // Keep the cached entry's callback refs current on every render
  useEffect(() => {
    const entry = terminalCache.get(sessionId);
    if (entry) {
      entry.onClosedRef.current = onClosed;
      entry.onResizeRef.current = onResize;
    }
  });

  const attach = useCallback(
    (container: HTMLDivElement | null) => {
      if (!container || mountCleanupRef.current) return;

      const existing = terminalCache.get(sessionId);

      // ── Reuse existing terminal ───────────────────────────────────────────
      if (existing) {
        const { terminal, fitAddon } = existing;
        existing.onClosedRef.current = onClosed;
        existing.onResizeRef.current = onResize;

        // Move the xterm element into the new container
        if (terminal.element) container.appendChild(terminal.element);

        fitAddon.fit();

        // Container-specific listeners (re-registered on each mount)
        const handleContextMenu = (e: MouseEvent) => {
          e.preventDefault();
          navigator.clipboard.readText().then((text) => { if (text) terminal.paste(text); });
        };
        container.addEventListener("contextmenu", handleContextMenu);

        const handleWindowResize = () => fitAddon.fit();
        window.addEventListener("resize", handleWindowResize);

        let fitTimer: ReturnType<typeof setTimeout> | null = null;
        const resizeObserver = new ResizeObserver(() => {
          if (fitTimer !== null) clearTimeout(fitTimer);
          fitTimer = setTimeout(() => { fitTimer = null; fitAddon.fit(); }, 50);
        });
        resizeObserver.observe(container);

        mountCleanupRef.current = () => {
          container.removeEventListener("contextmenu", handleContextMenu);
          window.removeEventListener("resize", handleWindowResize);
          resizeObserver.disconnect();
          if (fitTimer !== null) clearTimeout(fitTimer);
          mountCleanupRef.current = null;
        };
        return;
      }

      // ── Create new terminal ───────────────────────────────────────────────
      const activeTheme = useThemeStore.getState().getActiveTheme();
      const term = new Terminal({
        altClickMovesCursor: false,
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: activeTheme.terminalFontSize,
        fontFamily: activeTheme.terminalFontFamily,
        theme: activeTheme.terminal,
        overviewRuler: { width: 4 },
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      const searchAddon = new SearchAddon();
      term.loadAddon(searchAddon);

      let linkTooltip: HTMLDivElement | null = null;
      const hideLinkTooltip = () => {
        linkTooltip?.remove();
        linkTooltip = null;
      };
      const showLinkTooltip = (event: MouseEvent, uri: string) => {
        if (!isHttpUrl(uri)) return;
        if (!linkTooltip) {
          linkTooltip = document.createElement("div");
          linkTooltip.className = "xterm-hover";
          Object.assign(linkTooltip.style, {
            position: "fixed",
            zIndex: "10000",
            pointerEvents: "none",
            padding: "4px 8px",
            borderRadius: "6px",
            background: "var(--t-bg-card)",
            border: "1px solid var(--t-border)",
            color: "var(--t-text)",
            fontFamily: activeTheme.terminalFontFamily,
            fontSize: "12px",
            boxShadow: "0 8px 24px rgba(0, 0, 0, 0.28)",
            opacity: "0",
            transform: "translateY(4px)",
            transition: "opacity 150ms ease-out, transform 150ms ease-out",
            willChange: "opacity, transform",
            whiteSpace: "nowrap",
          });
          document.body.appendChild(linkTooltip);
          const tooltip = linkTooltip;
          requestAnimationFrame(() => {
            if (linkTooltip !== tooltip) return;
            tooltip.style.opacity = "1";
            tooltip.style.transform = "translateY(0)";
          });
        }
        linkTooltip.textContent = "Alt+click to open";
        linkTooltip.style.left = `${event.clientX + 12}px`;
        linkTooltip.style.top = `${event.clientY + 12}px`;
      };

      term.loadAddon(new WebLinksAddon((event, uri) => {
        if (!event.altKey || !isHttpUrl(uri)) return;
        openUrl(uri).catch(() => {});
      }, {
        hover: showLinkTooltip,
        leave: hideLinkTooltip,
      }));

      const encoder = new TextEncoder();
      const decoder = encoding ? new TextDecoder(encoding) : null;

      // Build the cache entry first so closures below can reference it
      const entry: CacheEntry = {
        terminal: term,
        fitAddon,
        searchAddon,
        search: { snapshot: { ...EMPTY_SNAPSHOT }, subscribers: new Set() },
        sessionType,
        connectedRef: { current: sessionType === "local" || sessionType === "serial" },
        onClosedRef: { current: onClosed },
        onResizeRef: { current: onResize },
        dispose: () => {}, // filled in below
      };
      terminalCache.set(sessionId, entry);

      const searchResultsDispose = searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
        entry.search.snapshot = { ...entry.search.snapshot, resultIndex, resultCount };
        notifySearch(entry);
      });

      // Intercept app shortcuts before xterm processes them
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        const layout = useLayoutStore.getState();
        const isSplitPaneTerminal = layout.splitTabActive && getPaneSessionIds(layout.root).includes(sessionId);
        if (isSplitPaneTerminal && e.ctrlKey && e.shiftKey && e.key === "Enter") {
          if (e.type === "keydown") {
            const activePaneId = layout.activePaneId;
            if (activePaneId) layout.setMaximized(layout.maximizedPaneId === activePaneId ? null : activePaneId);
          }
          return false;
        }
        if (isSplitPaneTerminal && e.key === "Escape" && layout.maximizedPaneId) {
          if (e.type === "keydown") useLayoutStore.getState().setMaximized(null);
          return false;
        }
        if (isSplitPaneTerminal && e.ctrlKey && e.shiftKey && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
          if (e.type === "keydown") {
            const direction = e.key === "ArrowLeft" ? "left" : e.key === "ArrowRight" ? "right" : e.key === "ArrowUp" ? "up" : "down";
            focusPaneInDirection(direction);
          }
          return false;
        }
        if (matchShortcut("omni", e)) {
          if (e.type === "keydown") useUIStore.getState().setOmniOpen(true);
          return false;
        }
        if (e.ctrlKey && e.shiftKey && e.key === "C") {
          if (e.type === "keydown") {
            const sel = term.getSelection();
            if (sel) navigator.clipboard.writeText(sel);
          }
          return false;
        }
        if (e.ctrlKey && e.shiftKey && e.key === "V") {
          e.preventDefault();
          if (e.type === "keydown") {
            navigator.clipboard.readText().then((text) => { if (text) term.paste(text); });
          }
          return false;
        }
        if (e.ctrlKey && !e.shiftKey && e.key === "c") {
          const sel = term.getSelection();
          if (sel) {
            if (e.type === "keydown") navigator.clipboard.writeText(sel);
            return false;
          }
          return true;
        }
        if (e.ctrlKey && !e.shiftKey && e.key === "v") {
          e.preventDefault();
          if (e.type === "keydown") {
            navigator.clipboard.readText().then((text) => { if (text) term.paste(text); });
          }
          return false;
        }
        if (matchShortcut("terminal-search", e)) {
          if (e.type === "keydown") {
            e.preventDefault();
            getTerminalSearchController(sessionId)?.open();
          }
          return false;
        }
        if (matchShortcut("history", e)) {
          if (e.type === "keydown") useUIStore.getState().toggleRightPanel("history");
          return false;
        }
        if (matchShortcut("snippets", e)) {
          if (e.type === "keydown") useUIStore.getState().toggleRightPanel("snippets");
          return false;
        }
        if (matchShortcut("panel-themes", e)) {
          if (e.type === "keydown") useUIStore.getState().toggleRightPanel("themes");
          return false;
        }
        return true;
      });

      term.open(container);

      try {
        term.loadAddon(new WebglAddon());
      } catch {
        // WebGL not available, use default canvas renderer
      }

      // Send user input
      const onDataDispose = term.onData((data) => {
        if (inputGate && !inputGate.current?.()) return;
        if (!entry.connectedRef.current) return;

        const sess = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
        if (sess) {
          useCommandHistoryStore
            .getState()
            .addInput(sessionId, sess.connectionName, sess.connectionId, data);
        }

        const bytes = encoder.encode(data);
        const layout = useLayoutStore.getState();
        const paneSessionIds = getPaneSessionIds(layout.root);
        if (layout.broadcastActive && layout.splitTabActive && paneSessionIds.includes(sessionId)) {
          const sessions = useSessionStore.getState().sessions;
          const mpConnections = useTeamSessionStore.getState().connections;
          for (const targetId of paneSessionIds) {
            const target = sessions.find((s) => s.id === targetId);
            if (!target || target.status !== "connected" || target.type === "multiplayer") continue;
            const mpState = mpConnections[target.id];
            if (mpState && mpState.controlHolder !== "" && mpState.controlHolder !== mpState.myUserId) continue;
            sendSessionInput(target.id, target.type === "serial" ? "serial" : target.type as "ssh" | "local", bytes);
          }
          return;
        }
        sendSessionInput(sessionId, sessionType, bytes);
      });

      const unlistenPromises: Promise<UnlistenFn>[] = [];

      if (sessionType === "local") {
        unlistenPromises.push(
          onLocalOutput(sessionId, (data) => { term.write(decoder ? decoder.decode(data) : data); }),
        );
        unlistenPromises.push(
          onLocalClosed(sessionId, () => {
            term.write("\r\n\x1b[90m--- Session closed ---\x1b[0m\r\n");
            entry.onClosedRef.current?.();
          }),
        );
      } else if (sessionType === "serial") {
        unlistenPromises.push(
          onSerialOutput(sessionId, (data) => { term.write(decoder ? decoder.decode(data) : data); }),
        );
        unlistenPromises.push(
          onSerialClosed(sessionId, () => {
            term.write("\r\n\x1b[90m--- Serial connection closed ---\x1b[0m\r\n");
            entry.onClosedRef.current?.();
          }),
        );
      } else {
        unlistenPromises.push(
          onSshOutput(sessionId, (data) => { term.write(decoder ? decoder.decode(data) : data); }),
        );
        unlistenPromises.push(
          onSshClosed(sessionId, () => {
            term.write("\r\n\x1b[90m--- Connection closed ---\x1b[0m\r\n");
            entry.onClosedRef.current?.();
          }),
        );
      }

      const onResizeDispose = term.onResize(({ cols, rows }) => {
        entry.onResizeRef.current?.(cols, rows);
        if (!entry.connectedRef.current) return;
        if (sessionType === "local") {
          localResize(sessionId, cols, rows);
        } else if (sessionType === "ssh") {
          sshResize(sessionId, cols, rows);
        }
      });

      fitAddon.fit();

      // Full teardown — only called when the session is deleted from the store
      entry.dispose = () => {
        onDataDispose.dispose();
        onResizeDispose.dispose();
        searchResultsDispose.dispose();
        entry.search.subscribers.clear();
        hideLinkTooltip();
        Promise.all(unlistenPromises).then((fns) => fns.forEach((fn) => fn()));
        term.dispose();
      };

      // Container-specific listeners (registered on each mount, torn down on unmount)
      const handleContextMenu = (e: MouseEvent) => {
        e.preventDefault();
        navigator.clipboard.readText().then((text) => { if (text) term.paste(text); });
      };
      container.addEventListener("contextmenu", handleContextMenu);

      const handleWindowResize = () => fitAddon.fit();
      window.addEventListener("resize", handleWindowResize);

      let fitTimer: ReturnType<typeof setTimeout> | null = null;
      const resizeObserver = new ResizeObserver(() => {
        if (fitTimer !== null) clearTimeout(fitTimer);
        fitTimer = setTimeout(() => { fitTimer = null; fitAddon.fit(); }, 50);
      });
      resizeObserver.observe(container);

      mountCleanupRef.current = () => {
        container.removeEventListener("contextmenu", handleContextMenu);
        window.removeEventListener("resize", handleWindowResize);
        resizeObserver.disconnect();
        if (fitTimer !== null) clearTimeout(fitTimer);
        mountCleanupRef.current = null;
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionId, sessionType, encoding],
  );

  // Live theme updates
  useEffect(() => {
    return useThemeStore.subscribe((state) => {
      const entry = terminalCache.get(sessionId);
      if (!entry) return;
      const { terminal: term, fitAddon } = entry;
      const theme = state.getActiveTheme();
      term.options.theme = theme.terminal;
      term.options.fontFamily = theme.terminalFontFamily;
      if (term.options.fontSize !== theme.terminalFontSize) {
        term.options.fontSize = theme.terminalFontSize;
        fitAddon.fit();
      }
    });
  }, [sessionId]);

  // Live theme preview
  useEffect(() => {
    const handler = (e: Event) => {
      const entry = terminalCache.get(sessionId);
      if (!entry) return;
      const { terminal: term, fitAddon } = entry;
      const theme = (e as CustomEvent).detail;
      term.options.theme = theme.terminal;
      term.options.fontFamily = theme.terminalFontFamily;
      if (term.options.fontSize !== theme.terminalFontSize) {
        term.options.fontSize = theme.terminalFontSize;
        fitAddon.fit();
      }
    };
    window.addEventListener("theme-preview", handler);
    return () => window.removeEventListener("theme-preview", handler);
  }, [sessionId]);

  // Mount-only cleanup — does NOT dispose the terminal (cache survives unmount)
  useEffect(() => {
    return () => {
      mountCleanupRef.current?.();
    };
  }, []);

  const focus = useCallback(() => {
    terminalCache.get(sessionId)?.terminal.focus();
  }, [sessionId]);

  const fit = useCallback(() => {
    const entry = terminalCache.get(sessionId);
    if (!entry) return;
    const { terminal: term, fitAddon } = entry;
    fitAddon.fit();
    // Force-send current dimensions — xterm suppresses onResize when cols/rows
    // haven't changed, which causes the PTY to stay at its initial 80x24 when
    // the session becomes active after connecting.
    if (!entry.connectedRef.current) return;
    if (sessionType === "local") {
      localResize(sessionId, term.cols, term.rows);
    } else if (sessionType === "ssh") {
      sshResize(sessionId, term.cols, term.rows);
    }
  }, [sessionId, sessionType]);

  return { attach, focus, fit };
}
