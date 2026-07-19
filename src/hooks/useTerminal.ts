import { attachTerminalClipboard, type TerminalClipboardHandle } from "@/components/terminal/terminalClipboard";
import { useEffect, useRef, useCallback } from "react";
import { Terminal, type IBufferCell, type IBufferRange } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { openUrl } from "@tauri-apps/plugin-opener";
import { sshSendInput, sshResize, onSshOutput, onSshClosed, onSshCwd } from "@/services/ssh";
import { localSendInput, localResize, onLocalOutput, onLocalClosed } from "@/services/local";
import { serialWrite, onSerialOutput, onSerialClosed } from "@/services/serial";
import { useThemeStore } from "@/stores/themeStore";
import { useUIStore } from "@/stores/uiStore";
import { useTerminalSettingsStore } from "@/stores/terminalSettingsStore";
import { matchShortcut } from "@/stores/shortcutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useTerminalCwdStore } from "@/stores/terminalCwdStore";
import { findLeaf, getPaneSessionIds, useLayoutStore } from "@/stores/layoutStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { useCommandHistoryStore } from "@/stores/commandHistoryStore";
import { consumeLatchForChar } from "@/stores/modifierLatchStore";
import { sampleLineDensities, scrollDeltaForRatio, type TerminalMinimapCell, type TerminalMinimapSample } from "@/components/terminal/minimapMath";
import type { TerminalTheme } from "@/themes/types";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { withFlagEmojiFallback } from "@/utils/emojiFont";

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

export interface TerminalMinimapSnapshot {
  bufferLength: number;
  viewportY: number;
  baseY: number;
  rows: number;
  cols: number;
  version: number;
}

interface MinimapState {
  snapshot: TerminalMinimapSnapshot;
  subscribers: Set<() => void>;
  frame: number | null;
}

export interface TerminalMinimapController {
  subscribe: (fn: () => void) => () => void;
  getSnapshot: () => TerminalMinimapSnapshot;
  sample: (height: number) => TerminalMinimapSample[];
  scrollToRatio: (ratio: number) => void;
  focus: () => void;
}

type CacheEntry = {
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  search: SearchState;
  minimap: MinimapState;
  sessionType: "ssh" | "local" | "serial";
  connectedRef: { current: boolean };
  /** Mirror of the useTerminal `inputGate` so module-level senders (writeToSession)
   *  honor the same multiplayer control-holder gate as the onData handler. */
  inputGateRef: { current: (() => boolean) | undefined };
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

function minimapSnapshot(entry: CacheEntry): TerminalMinimapSnapshot {
  const buffer = entry.terminal.buffer.active;
  return {
    bufferLength: buffer.length,
    viewportY: buffer.viewportY,
    baseY: buffer.baseY,
    rows: entry.terminal.rows,
    cols: entry.terminal.cols,
    version: entry.minimap.snapshot.version + 1,
  };
}

function notifyMinimap(entry: CacheEntry) {
  entry.minimap.snapshot = minimapSnapshot(entry);
  entry.minimap.subscribers.forEach((fn) => fn());
}

// Scroll position lives in the xterm buffer, not a store, so the workspace
// snapshot can't subscribe to it directly. Terminals notify these listeners on
// scroll; the snapshot sync registers a debounced write so the persisted offset
// tracks the viewport like cwd/layout do.
const scrollListeners = new Set<() => void>();

/** Subscribe to "a terminal scrolled" — returns an unsubscribe fn. */
export function subscribeTerminalScroll(fn: () => void): () => void {
  scrollListeners.add(fn);
  return () => scrollListeners.delete(fn);
}

function notifyScrollListeners(): void {
  scrollListeners.forEach((fn) => fn());
}

/** Lines the viewport is scrolled up from the live prompt (0 = at bottom).
 * Read by the workspace snapshot so restore can re-apply the position. */
export function getScrollOffset(sessionId: string): number {
  const entry = terminalCache.get(sessionId);
  if (!entry) return 0;
  const buffer = entry.terminal.buffer.active;
  return Math.max(0, buffer.baseY - buffer.viewportY);
}

// ─── Restore scroll position ─────────────────────────────────────────────────
// On workspace restore the buffer is rebuilt from a history replay + attach
// redraw streamed as plain output, with no "replay complete" signal. We re-arm
// a settle timer on each write and apply the saved offset once output goes
// quiet, with a hard cap so it fires even if output never fully settles.

const RESTORE_SETTLE_MS = 400;
const RESTORE_HARD_CAP_MS = 3000;
const pendingRestoreScroll = new Map<string, number>();
const restoreScrollTimers = new Map<
  string,
  { settle: ReturnType<typeof setTimeout> | null; cap: ReturnType<typeof setTimeout> }
>();

function applyRestoreScroll(sessionId: string): void {
  const offset = pendingRestoreScroll.get(sessionId);
  const timers = restoreScrollTimers.get(sessionId);
  if (timers) {
    if (timers.settle) clearTimeout(timers.settle);
    clearTimeout(timers.cap);
    restoreScrollTimers.delete(sessionId);
  }
  pendingRestoreScroll.delete(sessionId);
  if (!offset) return;
  const entry = terminalCache.get(sessionId);
  if (!entry) return;
  // Anchor to the bottom (where the attach redraw leaves us) then scroll up the
  // saved offset; xterm clamps at the top if the rebuilt buffer is shorter.
  entry.terminal.scrollToBottom();
  entry.terminal.scrollLines(-offset);
}

/** Record a scroll offset to re-apply after this session's restore replay.
 * Called before reconnect; a no-op for 0 (the session was at the bottom). */
export function setRestoreScrollOffset(sessionId: string, offset: number): void {
  if (offset <= 0) return;
  pendingRestoreScroll.set(sessionId, offset);
  restoreScrollTimers.set(sessionId, {
    settle: null,
    cap: setTimeout(() => applyRestoreScroll(sessionId), RESTORE_HARD_CAP_MS),
  });
}

function noteRestoreOutput(sessionId: string): void {
  const timers = restoreScrollTimers.get(sessionId);
  if (!timers) return;
  if (timers.settle) clearTimeout(timers.settle);
  timers.settle = setTimeout(() => applyRestoreScroll(sessionId), RESTORE_SETTLE_MS);
}

function scheduleMinimapNotify(entry: CacheEntry) {
  if (entry.minimap.frame !== null) return;
  entry.minimap.frame = requestAnimationFrame(() => {
    entry.minimap.frame = null;
    notifyMinimap(entry);
  });
}

function sampleMinimap(entry: CacheEntry, height: number): TerminalMinimapSample[] {
  const buffer = entry.terminal.buffer.active;
  const maxSamples = Math.max(1, Math.floor(height));
  const length = Math.max(1, buffer.length);
  const cols = Math.max(1, entry.terminal.cols);
  const theme = useThemeStore.getState().getActiveTheme().terminal;
  const lines: string[] = [];
  const cellRows: TerminalMinimapCell[][] = [];
  const nullCell = buffer.getNullCell();
  const rows = Math.min(maxSamples, length);

  for (let y = 0; y < rows; y += 1) {
    const start = length <= maxSamples ? y : Math.floor((y / rows) * length);
    const end = length <= maxSamples ? y + 1 : Math.max(start + 1, Math.floor(((y + 1) / rows) * length));
    let text = "";
    let cells: TerminalMinimapCell[] = [];

    for (let lineIndex = start; lineIndex < end; lineIndex += 1) {
      const line = buffer.getLine(lineIndex);
      if (!line) continue;
      const lineText = line.translateToString(true);
      if (!text && lineText) {
        text = lineText;
        const maxCells = Math.min(line.length, cols);
        cells = [];
        for (let x = 0; x < maxCells; x += 1) {
          const cell = line.getCell(x, nullCell);
          if (!cell || cell.getWidth() === 0 || !cell.getChars().trim() || cell.isInvisible()) continue;
          cells.push({
            x,
            width: Math.max(1, cell.getWidth()),
            fg: colorForCell(cell, "fg", theme),
            bg: cell.isBgDefault() ? undefined : colorForCell(cell, "bg", theme),
          });
        }
      }
    }
    lines.push(text);
    cellRows.push(cells);
  }

  return sampleLineDensities(lines, maxSamples, cols).map((sample, index) => ({
    ...sample,
    cells: cellRows[index],
  }));
}

function colorForCell(cell: IBufferCell, target: "fg" | "bg", theme: TerminalTheme): string {
  const color = target === "fg" ? cell.getFgColor() : cell.getBgColor();
  const isDefault = target === "fg" ? cell.isFgDefault() : cell.isBgDefault();
  const isRgb = target === "fg" ? cell.isFgRGB() : cell.isBgRGB();
  const isPalette = target === "fg" ? cell.isFgPalette() : cell.isBgPalette();

  if (isDefault) return target === "fg" ? theme.foreground : theme.background;
  if (isRgb) return `#${color.toString(16).padStart(6, "0")}`;
  if (isPalette) return ansiPaletteColor(color, theme);
  return target === "fg" ? theme.foreground : theme.background;
}

function ansiPaletteColor(index: number, theme: TerminalTheme): string {
  const basic = [
    theme.black, theme.red, theme.green, theme.yellow,
    theme.blue, theme.magenta, theme.cyan, theme.white,
    theme.brightBlack, theme.brightRed, theme.brightGreen, theme.brightYellow,
    theme.brightBlue, theme.brightMagenta, theme.brightCyan, theme.brightWhite,
  ];
  if (index < basic.length) return basic[index];
  if (index >= 16 && index <= 231) {
    const n = index - 16;
    const r = Math.floor(n / 36);
    const g = Math.floor((n % 36) / 6);
    const b = n % 6;
    return rgbHex(r === 0 ? 0 : 55 + r * 40, g === 0 ? 0 : 55 + g * 40, b === 0 ? 0 : 55 + b * 40);
  }
  if (index >= 232 && index <= 255) {
    const v = 8 + (index - 232) * 10;
    return rgbHex(v, v, v);
  }
  return theme.foreground;
}

function rgbHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}

function scrollMinimapToRatio(entry: CacheEntry, ratio: number) {
  const buffer = entry.terminal.buffer.active;
  const delta = scrollDeltaForRatio(ratio, buffer.length, entry.terminal.rows, buffer.viewportY);
  entry.terminal.scrollLines(delta);
  scheduleMinimapNotify(entry);
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

/** Live terminal dimensions, so request_pty starts at the real window size
 * (screen/tmux pin their layout to the size at creation). */
export function getTerminalDims(sessionId: string): { cols: number; rows: number } | null {
  const entry = terminalCache.get(sessionId);
  if (!entry) return null;
  const { cols, rows } = entry.terminal;
  if (!cols || !rows) return null;
  return { cols, rows };
}

/** Re-fit a session's xterm to its current container (call on viewport/keyboard resize).
 *  Fast-path complement to the per-container ResizeObserver: fires immediately on the
 *  caller's frame rather than after the observer's debounce, for snappier keyboard reflow. */
export function refitSession(sessionId: string): void {
  const entry = terminalCache.get(sessionId);
  if (!entry) return;
  try { entry.fitAddon.fit(); } catch { /* container not laid out yet */ }
}

/** Programmatically send input to a session's PTY (used by the mobile extra-keys row).
 *  Mirrors the onData path: honors the multiplayer input gate, respects connected state,
 *  records history, encodes + sends. Does not replicate the split-pane broadcast branch
 *  (mobile sends to the active session only). */
export function writeToSession(sessionId: string, data: string): void {
  const entry = terminalCache.get(sessionId);
  if (!entry) return;
  if (entry.inputGateRef.current && !entry.inputGateRef.current()) return;
  if (!entry.connectedRef.current) return;
  const sess = useSessionStore.getState().sessions.find((s) => s.id === sessionId);
  if (sess) {
    useCommandHistoryStore.getState().addInput(sessionId, sess.connectionName, sess.connectionId, data);
  }
  const bytes = new TextEncoder().encode(data);
  sendSessionInput(sessionId, entry.sessionType, bytes);
}

/** Whether the session's xterm is in application-cursor-keys mode (DECCKM).
 *  Arrows must send ESC O x instead of ESC [ x when set. */
export function getAppCursorMode(sessionId: string): boolean {
  const entry = terminalCache.get(sessionId);
  return entry?.terminal.modes.applicationCursorKeysMode ?? false;
}

export interface TerminalApi {
  scrollLines(delta: number): void;
  cols(): number;
  rows(): number;
  /** Absolute buffer line at the top of the viewport. */
  viewportTop(): number;
  /** The live `.xterm-screen` element (for cell-metric measurement), or null. */
  screenEl(): HTMLElement | null;
  /** Rendered text of an absolute buffer line (trimmed-right false). */
  lineText(line: number): string;
  select(col: number, line: number, len: number): void;
  selectLines(start: number, end: number): void;
  selectAll(): void;
  clearSelection(): void;
  getSelection(): string;
  getSelectionPosition(): IBufferRange | undefined;
  paste(text: string): void;
}

/** Narrow facade over a cached terminal for the mobile gesture layer. Null when no
 *  terminal is cached for the session yet. */
export function getTerminalApi(sessionId: string): TerminalApi | null {
  const entry = terminalCache.get(sessionId);
  if (!entry) return null;
  const term = entry.terminal;
  return {
    scrollLines: (delta) => term.scrollLines(delta),
    cols: () => term.cols,
    rows: () => term.rows,
    viewportTop: () => term.buffer.active.viewportY,
    screenEl: () => term.element?.querySelector<HTMLElement>(".xterm-screen") ?? null,
    lineText: (line) => term.buffer.active.getLine(line)?.translateToString(false) ?? "",
    select: (col, line, len) => term.select(col, line, len),
    selectLines: (start, end) => term.selectLines(start, end),
    selectAll: () => term.selectAll(),
    clearSelection: () => term.clearSelection(),
    getSelection: () => term.getSelection(),
    getSelectionPosition: () => term.getSelectionPosition(),
    paste: (text) => term.paste(text),
  };
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

export function getTerminalMinimapController(sessionId: string): TerminalMinimapController | null {
  const entry = terminalCache.get(sessionId);
  if (!entry) return null;
  const subscribers = entry.minimap.subscribers;
  return {
    subscribe: (fn) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; },
    getSnapshot: () => entry.minimap.snapshot,
    sample: (height) => sampleMinimap(entry, height),
    scrollToRatio: (ratio) => scrollMinimapToRatio(entry, ratio),
    focus: () => entry.terminal.focus(),
  };
}

/** Open the search widget for a given session (no-op if the session has no cached terminal yet). */
export function openTerminalSearch(sessionId: string): void {
  getTerminalSearchController(sessionId)?.open();
}

useSessionStore.subscribe((state) => {
  const currentIds = new Set(state.sessions.map((s) => s.id));
  for (const [id, entry] of terminalCache) {
    if (!currentIds.has(id)) {
      entry.dispose();
      terminalCache.delete(id);
    }
  }

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
  const clipRef = useRef<TerminalClipboardHandle | null>(null);

  // Keep the cached entry's callback refs current on every render
  useEffect(() => {
    const entry = terminalCache.get(sessionId);
    if (entry) {
      entry.inputGateRef.current = inputGate?.current;
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
        existing.inputGateRef.current = inputGate?.current;
        existing.onClosedRef.current = onClosed;
        existing.onResizeRef.current = onResize;

        if (terminal.element) container.appendChild(terminal.element);

        fitAddon.fit();

        // Container-specific listeners (re-registered on each mount)
        const clip = attachTerminalClipboard(terminal, container, { osc52: true });
        clipRef.current = clip;

        const handleWindowResize = () => fitAddon.fit();
        window.addEventListener("resize", handleWindowResize);

        let fitTimer: ReturnType<typeof setTimeout> | null = null;
        const resizeObserver = new ResizeObserver(() => {
          if (fitTimer !== null) clearTimeout(fitTimer);
          fitTimer = setTimeout(() => { fitTimer = null; fitAddon.fit(); }, 50);
        });
        resizeObserver.observe(container);

        mountCleanupRef.current = () => {
          clip.dispose();
          if (clipRef.current === clip) clipRef.current = null;
          window.removeEventListener("resize", handleWindowResize);
          resizeObserver.disconnect();
          if (fitTimer !== null) clearTimeout(fitTimer);
          mountCleanupRef.current = null;
        };
        return;
      }

      // ── Create new terminal ───────────────────────────────────────────────
      const activeTheme = useThemeStore.getState().getActiveTheme();
      const scrollback = useTerminalSettingsStore.getState().scrollbackLines;
      const term = new Terminal({
        altClickMovesCursor: false,
        cursorBlink: true,
        cursorStyle: "bar",
        fontSize: activeTheme.terminalFontSize,
        fontFamily: withFlagEmojiFallback(activeTheme.terminalFontFamily),
        scrollback,
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
            fontFamily: withFlagEmojiFallback(activeTheme.terminalFontFamily),
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
        minimap: {
          snapshot: { bufferLength: 0, viewportY: 0, baseY: 0, rows: term.rows, cols: term.cols, version: 0 },
          subscribers: new Set(),
          frame: null,
        },
        sessionType,
        connectedRef: { current: sessionType === "local" || sessionType === "serial" },
        inputGateRef: { current: inputGate?.current },
        onClosedRef: { current: onClosed },
        onResizeRef: { current: onResize },
        dispose: () => {}, // filled in below
      };
      terminalCache.set(sessionId, entry);
      notifyMinimap(entry);

      const searchResultsDispose = searchAddon.onDidChangeResults(({ resultIndex, resultCount }) => {
        entry.search.snapshot = { ...entry.search.snapshot, resultIndex, resultCount };
        notifySearch(entry);
      });

      const scrollDispose = term.onScroll(() => {
        scheduleMinimapNotify(entry);
        notifyScrollListeners();
      });
      const bufferChangeDispose = term.buffer.onBufferChange(() => scheduleMinimapNotify(entry));

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
        const clipResult = clipRef.current?.handleKeyEvent(e);
        if (clipResult != null) return clipResult;
        if (matchShortcut("terminal-search", e)) {
          if (e.type === "keydown") {
            e.preventDefault();
            getTerminalSearchController(sessionId)?.open();
          }
          return false;
        }
        if (e.ctrlKey && !e.altKey && (e.key === "g" || e.key === "G")) {
          if (e.type === "keydown") {
            const ctrl = getTerminalSearchController(sessionId);
            if (ctrl?.getSnapshot().open) {
              if (e.shiftKey) ctrl.prev();
              else ctrl.next();
            }
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

      // OSC 7 — shell-reported cwd (file://host/path). Used by the right-panel
      // SFTP tab's "follow cwd" feature. Silently no-ops for shells that don't
      // emit it.
      const oscCwdDispose = term.parser.registerOscHandler(7, (data) => {
        try {
          if (!data.startsWith("file://")) return false;
          // Manual parse — URL constructor mangles Windows backslashes and
          // throws on unencoded characters that cmd's $P happily includes.
          const rest = data.slice("file://".length);
          const slashIdx = rest.indexOf("/");
          if (slashIdx === -1) return true;
          const host = rest.slice(0, slashIdx);
          const raw = rest.slice(slashIdx);
          let path: string;
          try { path = decodeURIComponent(raw); } catch { path = raw; }
          // Windows drive paths arrive as `/C:\Users\foo` (from cmd's $P) —
          // strip the leading slash, normalize backslashes for display.
          if (/^\/[A-Za-z]:/.test(path)) path = path.slice(1);
          path = path.replace(/\\/g, "/");
          // WSL sessions emit host=wsl.localhost with the distro embedded as
          // the first path segment. Convert to a UNC path that Windows' fs
          // API can actually read (`\\wsl.localhost\<distro>\…`).
          if (host === "wsl.localhost" || host === "wsl$") {
            path = `//${host}${path}`;
          }
          if (path) useTerminalCwdStore.getState().setCwd(sessionId, path);
        } catch { /* malformed OSC 7 payload */ }
        return true;
      });

      const onDataDispose = term.onData((data) => {
        if (inputGate && !inputGate.current?.()) return;
        if (!entry.connectedRef.current) return;

        // Mobile extra-keys row: apply a latched virtual Ctrl/Alt to this typed char
        // (e.g. latch Ctrl, type "c" → Ctrl-C). Inert on desktop (latch never armed).
        const latched = consumeLatchForChar(data);
        if (latched !== null) data = latched;

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
          onLocalOutput(sessionId, (data) => { term.write(decoder ? decoder.decode(data) : data, () => scheduleMinimapNotify(entry)); }),
        );
        unlistenPromises.push(
          onLocalClosed(sessionId, () => {
            term.write("\r\n\x1b[90m--- Session closed ---\x1b[0m\r\n");
            entry.onClosedRef.current?.();
          }),
        );
      } else if (sessionType === "serial") {
        unlistenPromises.push(
          onSerialOutput(sessionId, (data) => { term.write(decoder ? decoder.decode(data) : data, () => scheduleMinimapNotify(entry)); }),
        );
        unlistenPromises.push(
          onSerialClosed(sessionId, () => {
            term.write("\r\n\x1b[90m--- Serial connection closed ---\x1b[0m\r\n");
            entry.onClosedRef.current?.();
          }),
        );
      } else {
        unlistenPromises.push(
          onSshOutput(sessionId, (data) => {
            term.write(decoder ? decoder.decode(data) : data, () => scheduleMinimapNotify(entry));
            noteRestoreOutput(sessionId);
          }),
        );
        unlistenPromises.push(
          onSshClosed(sessionId, () => {
            entry.onClosedRef.current?.();
          }),
        );
        // Persistent sessions (tmux/screen) hide the shell's OSC 7 from the
        // terminal, so the backend polls the multiplexer for the cwd instead.
        unlistenPromises.push(
          onSshCwd(sessionId, (cwd) => {
            if (cwd) useTerminalCwdStore.getState().setCwd(sessionId, cwd);
          }),
        );
      }

      const onResizeDispose = term.onResize(({ cols, rows }) => {
        entry.onResizeRef.current?.(cols, rows);
        scheduleMinimapNotify(entry);
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
        oscCwdDispose.dispose();
        searchResultsDispose.dispose();
        scrollDispose.dispose();
        bufferChangeDispose.dispose();
        if (entry.minimap.frame !== null) cancelAnimationFrame(entry.minimap.frame);
        entry.search.subscribers.clear();
        entry.minimap.subscribers.clear();
        hideLinkTooltip();
        Promise.all(unlistenPromises).then((fns) => fns.forEach((fn) => fn()));
        term.dispose();
      };

      // Container-specific listeners (registered on each mount, torn down on unmount)
      const clip = attachTerminalClipboard(term, container, { osc52: true });
      clipRef.current = clip;

      const handleWindowResize = () => fitAddon.fit();
      window.addEventListener("resize", handleWindowResize);

      let fitTimer: ReturnType<typeof setTimeout> | null = null;
      const resizeObserver = new ResizeObserver(() => {
        if (fitTimer !== null) clearTimeout(fitTimer);
        fitTimer = setTimeout(() => { fitTimer = null; fitAddon.fit(); }, 50);
      });
      resizeObserver.observe(container);

      mountCleanupRef.current = () => {
        clip.dispose();
        if (clipRef.current === clip) clipRef.current = null;
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
      term.options.fontFamily = withFlagEmojiFallback(theme.terminalFontFamily);
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
      term.options.fontFamily = withFlagEmojiFallback(theme.terminalFontFamily);
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
