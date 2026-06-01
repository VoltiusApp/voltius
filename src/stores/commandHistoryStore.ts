import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface CommandHistoryEntry {
  id: string;
  command: string;
  timestamp: number;
  sessionId: string;
  sessionName: string;
  connectionId: string;
}

interface CommandHistoryStore {
  entries: CommandHistoryEntry[];
  buffers: Record<string, string>;
  addInput: (
    sessionId: string,
    sessionName: string,
    connectionId: string,
    data: string,
  ) => void;
  clear: () => void;
  remove: (id: string) => void;
}

const MAX_HISTORY = 500;

// Drop input events that are pure ANSI escape sequences (arrow keys, function
// keys, paste bracket markers, etc.). These get sent verbatim by xterm.js and
// would otherwise pollute the line buffer.
function isEscapeSequence(data: string): boolean {
  return data.charCodeAt(0) === 0x1b;
}

export const useCommandHistoryStore = create<CommandHistoryStore>()(
  persist(
    (set) => ({
      entries: [],
      buffers: {},

      addInput: (sessionId, sessionName, connectionId, data) => {
        if (isEscapeSequence(data)) return;

        set((state) => {
          let buf = state.buffers[sessionId] ?? "";
          const newEntries: CommandHistoryEntry[] = [];

          for (const ch of data) {
            const code = ch.charCodeAt(0);

            if (ch === "\r" || ch === "\n") {
              const cmd = buf.trim();
              if (cmd.length > 0) {
                newEntries.push({
                  id: crypto.randomUUID(),
                  command: cmd,
                  timestamp: Date.now(),
                  sessionId,
                  sessionName,
                  connectionId,
                });
              }
              buf = "";
            } else if (ch === "\x7f" || ch === "\b") {
              buf = buf.slice(0, -1);
            } else if (code === 0x03 || code === 0x15) {
              // Ctrl+C or Ctrl+U — abandon the current line
              buf = "";
            } else if (code >= 0x20 && code !== 0x7f) {
              buf += ch;
            }
            // Tabs, other control chars: skip (won't match what shell does with them anyway)
          }

          const dedupedEntries =
            newEntries.length > 0
              ? dedupeTail([...state.entries, ...newEntries]).slice(-MAX_HISTORY)
              : state.entries;

          return {
            entries: dedupedEntries,
            buffers: { ...state.buffers, [sessionId]: buf },
          };
        });
      },

      clear: () => set({ entries: [] }),
      remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
    }),
    {
      name: "voltius-command-history",
      partialize: (s) => ({ entries: s.entries }),
    },
  ),
);

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
