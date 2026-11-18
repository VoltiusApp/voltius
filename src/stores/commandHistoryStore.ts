import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isTeamConnection } from "@/services/teamConnectionIds";
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

/** Where a typed line's echo would start. `text` is null once that line is gone. */
export interface EchoAnchor {
  text(): string | null;
  left(): boolean;
  dispose(): void;
}

/** Where the shell's prompt ends. `command` reads the line the shell is about to run, or null when unsure. */
export interface PromptAnchor {
  command(): string | null;
  dispose(): void;
}

export interface EchoProbe {
  anchor(): EchoAnchor | null;
  /** `ahead`: keys typed before the prompt appeared, which the shell redraws after it. */
  promptAnchor(ahead: string): PromptAnchor | null;
  onOutput(cb: () => void): () => void;
}

interface CommandHistoryStore {
  entries: CommandHistoryEntry[];
  buffers: Record<string, string>;
  /** A typed line is kept only once the terminal shows it back: hidden prompts (sudo, ssh passphrases) never do. */
  addInput: (sessionId: string, sessionName: string, connectionId: string, data: string, echo: EchoProbe) => void;
  /** An OSC 133 mark from the session's shell: at C the line it runs is read off the screen. */
  addShellMark: (sessionId: string, sessionName: string, connectionId: string, payload: string, echo: EchoProbe) => void;
  clear: () => void;
  remove: (id: string) => void;
}

const MAX_HISTORY = 500;

export const ECHO_WAIT_MS = 2000;

// Arrow keys, function keys, paste bracket markers: not line content.
function isEscapeSequence(data: string): boolean {
  return data.charCodeAt(0) === 0x1b;
}

const historyEnabled = () => getToggle("command-history");

const anchors = new Map<string, EchoAnchor>();
/** Sessions with an entered line still waiting for its echo: what is typed meanwhile has no prompt to land after. */
const awaiting = new Map<string, () => void>();

interface ShellPrompt {
  anchor: PromptAnchor | null;
  touched: boolean;
  /** The echo-checked typed line, used when the screen cannot be read at C. */
  typed: string | null;
  phase: "typing" | "waiting" | "done";
}

/** Each session's prompt since its last A mark. */
const prompts = new Map<string, ShellPrompt>();
/** Sessions whose shell sends C: their commands are read at C, not at Enter. */
const sendsC = new Set<string>();

function dropAnchor(sessionId: string): void {
  anchors.get(sessionId)?.dispose();
  anchors.delete(sessionId);
}

function dropPrompt(sessionId: string): void {
  prompts.get(sessionId)?.anchor?.dispose();
  prompts.delete(sessionId);
}

/** Trailing text set apart by a gap (a right prompt) is allowed. */
function echoes(shown: string, command: string): boolean {
  const line = shown.trim();
  return line === command || line.startsWith(`${command}  `);
}

// pwfeedback and many TUIs echo one mask character per key.
const MASK_ONLY = /^[*•●·]+$/u;

/** Settles on the first output that shows `command` at `anchor`; a lost command is acceptable, a stored password is not. */
function awaitEcho(sessionId: string, command: string, anchor: EchoAnchor | undefined, echo: EchoProbe, keep: () => void): void {
  if (!anchor) return;
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
      keep();
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
    (set, get) => {
      // A leading space keeps a line out of history, as with HISTCONTROL=ignorespace.
      const record = (sessionId: string, sessionName: string, connectionId: string, line: string) => {
        if (!historyEnabled() || /^\s/.test(line)) return;
        const command = line.trim();
        if (!command || MASK_ONLY.test(command)) return;
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

      return {
        entries: [],
        buffers: {},

        addInput: (sessionId, sessionName, connectionId, data, echo) => {
          if (!historyEnabled()) {
            dropAnchor(sessionId);
            if (get().buffers[sessionId]) set((s) => ({ buffers: { ...s.buffers, [sessionId]: "" } }));
            return;
          }
          const prompt = prompts.get(sessionId);
          // Ctrl+L redraws the prompt elsewhere: anchor on the next key instead.
          if (prompt?.phase === "typing" && !prompt.touched && data !== "\x0c") {
            prompt.touched = true;
            prompt.anchor = echo.promptAnchor(get().buffers[sessionId] ?? "");
          }
          if (isEscapeSequence(data)) return;

          // At a marked prompt the C mark has the final say; until a C is seen the echo check settles it.
          const keep = (line: string, shell: ShellPrompt | undefined) => () => {
            if (shell?.phase === "typing" && sendsC.has(sessionId)) {
              shell.typed = line;
              return;
            }
            if (shell?.phase === "done") return;
            if (shell) shell.phase = "done";
            record(sessionId, sessionName, connectionId, line);
          };

          let buf = get().buffers[sessionId] ?? "";
          // A line typed after an Enter in this same input has no prompt of its own on screen yet.
          let enteredHere = false;

          for (const ch of data) {
            const code = ch.charCodeAt(0);

            if (ch === "\r" || ch === "\n") {
              const anchor = anchors.get(sessionId);
              anchors.delete(sessionId);
              const shell = prompts.get(sessionId);
              if (buf.trim()) awaitEcho(sessionId, buf.trim(), anchor, echo, keep(buf, shell?.phase === "typing" ? shell : undefined));
              else anchor?.dispose();
              buf = "";
              enteredHere = true;
            } else if (ch === "\x7f" || ch === "\b") {
              buf = buf.slice(0, -1);
            } else if (code === 0x03) {
              // Ctrl+C: the shell draws a fresh prompt on a new row.
              buf = "";
              dropAnchor(sessionId);
            } else if (code === 0x15) {
              // Ctrl+U: the shell erases back to the same prompt.
              buf = "";
            } else if (code >= 0x20 && code !== 0x7f) {
              if (buf === "" && !anchors.has(sessionId) && !enteredHere && !awaiting.has(sessionId)) {
                const anchor = echo.anchor();
                if (anchor) anchors.set(sessionId, anchor);
              }
              buf += ch;
            }
            // Tabs and other control keys change the line in ways the buffer cannot follow.
          }

          set((s) => ({ buffers: { ...s.buffers, [sessionId]: buf } }));
        },

        addShellMark: (sessionId, sessionName, connectionId, payload, echo) => {
          const kind = payload.split(";", 1)[0];
          const prompt = prompts.get(sessionId);
          if (kind === "A") {
            // Two prompts with no C between: this shell does not send C, so the echo check decides.
            if (prompt?.phase === "typing" && prompt.typed !== null) {
              sendsC.delete(sessionId);
              record(sessionId, sessionName, connectionId, prompt.typed);
            }
            dropPrompt(sessionId);
            if (historyEnabled()) prompts.set(sessionId, { anchor: null, touched: false, typed: null, phase: "typing" });
          } else if (kind === "B") {
            if (prompt?.phase !== "typing") return;
            prompt.anchor?.dispose();
            prompt.anchor = echo.promptAnchor("");
            prompt.touched = true;
          } else if (kind === "C") {
            sendsC.add(sessionId);
            if (prompt?.phase !== "typing") return;
            const shown = prompt.anchor?.command() ?? null;
            prompt.anchor?.dispose();
            prompt.anchor = null;
            const line = shown?.trim() ? shown : prompt.typed;
            if (line === null) {
              prompt.phase = "waiting";
              return;
            }
            prompt.phase = "done";
            record(sessionId, sessionName, connectionId, line);
          }
        },

        clear: () => set({ entries: [] }),
        remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
      };
    },
    {
      name: "voltius-command-history",
      partialize: (s) => ({ entries: s.entries.filter((e) => !e.team) }),
    },
  ),
);

/** Drops a session's half-typed line and pending checks. */
export function forgetSession(sessionId: string): void {
  awaiting.get(sessionId)?.();
  dropAnchor(sessionId);
  dropPrompt(sessionId);
  sendsC.delete(sessionId);
  const buffers = { ...useCommandHistoryStore.getState().buffers };
  delete buffers[sessionId];
  useCommandHistoryStore.setState({ buffers });
}

// Turning history off stops recording, including lines still waiting to be kept; what was saved stays until cleared.
function stopWhenOff(): void {
  if (historyEnabled()) return;
  const ids = new Set([...awaiting.keys(), ...anchors.keys(), ...prompts.keys()]);
  for (const id of ids) forgetSession(id);
  if (Object.keys(useCommandHistoryStore.getState().buffers).length > 0) useCommandHistoryStore.setState({ buffers: {} });
}

useToggleSettingsStore.subscribe(stopWhenOff);
usePolicyStore.subscribe(stopWhenOff);

// Same text back-to-back in one session is one entry, as in shell history.
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
