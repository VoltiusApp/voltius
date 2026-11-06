import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isTeamConnection } from "@/services/teamConnectionIds";
import { dropParkedKey } from "./persistedAccountUiState";
import { usePolicyStore } from "./policyStore";
import { getToggle, useToggleSettingsStore } from "./toggleSettingsStore";

export interface CommandHistoryEntry {
  id: string;
  command: string;
  timestamp: number;
  sessionId: string;
  sessionName: string;
  connectionId: string;
  /** Typed on a team host: kept in memory, never written to disk. */
  team?: true;
}

/** A spot in a terminal where a typed line's echo would start. */
export interface EchoAnchor {
  /** What the terminal shows from the anchor to the end of its (wrapped) line; null once that line is gone. */
  text(): string | null;
  /** Whether the cursor has moved off the anchor's line. */
  left(): boolean;
  dispose(): void;
}

/** The slice of a session's terminal the history needs to see what it echoed. */
export interface EchoProbe {
  /** Anchor at the cursor, or null where an echo could not be told from other output. */
  anchor(): EchoAnchor | null;
  /** Calls back each time the terminal has parsed more output. Returns the unsubscribe. */
  onOutput(cb: () => void): () => void;
}

interface CommandHistoryStore {
  entries: CommandHistoryEntry[];
  buffers: Record<string, string>;
  /**
   * Feed what was typed or pasted into a session. A line is kept only once the
   * terminal has shown it back: a prompt that hides input (sudo, su, passwd, an
   * ssh passphrase) never echoes, so what was typed there never becomes history.
   */
  addInput: (
    sessionId: string,
    sessionName: string,
    connectionId: string,
    data: string,
    echo: EchoProbe,
  ) => void;
  clear: () => void;
  remove: (id: string) => void;
}

const MAX_HISTORY = 500;
const STORAGE_KEY = "voltius-command-history";

/** How long a line may wait for its echo on a slow link before it is dropped. */
export const ECHO_WAIT_MS = 2000;

// Drop input events that are pure ANSI escape sequences (arrow keys, function
// keys, paste bracket markers, etc.). These get sent verbatim by xterm.js and
// would otherwise pollute the line buffer.
function isEscapeSequence(data: string): boolean {
  return data.charCodeAt(0) === 0x1b;
}

export const historyEnabled = () => getToggle("command-history");

/** Where the line being typed in each session would be echoed, if anywhere yet. */
const anchors = new Map<string, EchoAnchor>();
/** Sessions with an entered line still waiting for its echo: what is typed meanwhile has no prompt to land after. */
const awaiting = new Map<string, () => void>();

function dropAnchor(sessionId: string): void {
  anchors.get(sessionId)?.dispose();
  anchors.delete(sessionId);
}

/** The terminal shows the line as typed. Trailing text set apart by a gap (a right prompt) is allowed. */
function echoes(shown: string, command: string): boolean {
  const line = shown.trim();
  return line === command || line.startsWith(`${command}  `);
}

// `sudo -S` with pwfeedback, and many TUIs, echo one mask character per key: matching
// "****" against "****" would store a password that is itself only mask characters.
const MASK_ONLY = /^[*•●·]+$/u;

/**
 * Keep `command` once the terminal echoes it at `anchor`. Settles on the first
 * output that shows it, and drops it when the cursor leaves the line without it,
 * the line disappears, or the wait runs out: a lost command is acceptable, a
 * stored password is not.
 */
function awaitEcho(
  sessionId: string,
  command: string,
  anchor: EchoAnchor | undefined,
  echo: EchoProbe,
  keep: () => void,
): void {
  if (!anchor) return;
  if (MASK_ONLY.test(command)) return anchor.dispose();
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const finish = () => {
    unsubscribe?.();
    if (timer) clearTimeout(timer);
    anchor.dispose();
    if (awaiting.get(sessionId) === finish) awaiting.delete(sessionId);
  };
  const settled = () => {
    const shown = anchor.text();
    if (shown !== null && echoes(shown, command)) {
      finish();
      if (historyEnabled()) keep();
      return true;
    }
    if (shown === null || anchor.left()) {
      finish();
      return true;
    }
    return false;
  };
  if (settled()) return;
  awaiting.get(sessionId)?.();
  awaiting.set(sessionId, finish);
  unsubscribe = echo.onOutput(() => void settled());
  timer = setTimeout(finish, ECHO_WAIT_MS);
}

export const useCommandHistoryStore = create<CommandHistoryStore>()(
  persist(
    (set, get) => ({
      entries: [],
      buffers: {},

      addInput: (sessionId, sessionName, connectionId, data, echo) => {
        if (isEscapeSequence(data)) return;
        if (!historyEnabled()) {
          dropAnchor(sessionId);
          if (get().buffers[sessionId]) set((s) => ({ buffers: { ...s.buffers, [sessionId]: "" } }));
          return;
        }

        const keep = (command: string) => () => {
          const entry: CommandHistoryEntry = {
            id: crypto.randomUUID(),
            command,
            timestamp: Date.now(),
            sessionId,
            sessionName,
            connectionId,
            ...(isTeamConnection(connectionId) ? { team: true as const } : {}),
          };
          set((s) => ({ entries: dedupeTail([...s.entries, entry]).slice(-MAX_HISTORY) }));
        };

        let buf = get().buffers[sessionId] ?? "";
        // A line typed after an Enter in this same input has no prompt of its own on screen yet.
        let enteredHere = false;

        for (const ch of data) {
          const code = ch.charCodeAt(0);

          if (ch === "\r" || ch === "\n") {
            const cmd = buf.trim();
            const anchor = anchors.get(sessionId);
            anchors.delete(sessionId);
            if (cmd.length > 0) awaitEcho(sessionId, cmd, anchor, echo, keep(cmd));
            else anchor?.dispose();
            buf = "";
            enteredHere = true;
          } else if (ch === "\x7f" || ch === "\b") {
            buf = buf.slice(0, -1);
          } else if (code === 0x03) {
            // Ctrl+C — abandon the line; the shell draws a fresh prompt on a new row
            buf = "";
            dropAnchor(sessionId);
          } else if (code === 0x15) {
            // Ctrl+U — abandon the line; the shell erases back to the same prompt
            buf = "";
          } else if (code >= 0x20 && code !== 0x7f) {
            if (buf === "" && !anchors.has(sessionId) && !enteredHere && !awaiting.has(sessionId)) {
              const anchor = echo.anchor();
              if (anchor) anchors.set(sessionId, anchor);
            }
            buf += ch;
          }
          // Tabs, other control chars: skip (won't match what shell does with them anyway)
        }

        set((s) => ({ buffers: { ...s.buffers, [sessionId]: buf } }));
      },

      clear: () => set({ entries: [] }),
      remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
    }),
    {
      name: STORAGE_KEY,
      partialize: (s) => ({ entries: s.entries.filter((e) => !e.team) }),
    },
  ),
);

/**
 * With history turned off — by the user, a synced choice or a team policy —
 * nothing recorded may stay behind: not the live entries, not the half-typed
 * lines, and not the copies parked for this device's other accounts.
 */
export function enforceHistoryToggle(): void {
  if (historyEnabled()) return;
  for (const finish of [...awaiting.values()]) finish();
  for (const id of [...anchors.keys()]) dropAnchor(id);
  const { entries, buffers } = useCommandHistoryStore.getState();
  if (entries.length > 0 || Object.keys(buffers).length > 0) {
    useCommandHistoryStore.setState({ entries: [], buffers: {} });
  }
  dropParkedKey(STORAGE_KEY);
}

enforceHistoryToggle();
useToggleSettingsStore.subscribe(enforceHistoryToggle);
usePolicyStore.subscribe(enforceHistoryToggle);

// Collapse immediately repeated commands (same text back-to-back within the
// same session) into a single entry — matches typical shell history behavior.
function dedupeTail(entries: CommandHistoryEntry[]): CommandHistoryEntry[] {
  const out: CommandHistoryEntry[] = [];
  for (const e of entries) {
    const prev = out[out.length - 1];
    if (prev && prev.command === e.command && prev.sessionId === e.sessionId) {
      out[out.length - 1] = e;
    } else {
      out.push(e);
    }
  }
  return out;
}
