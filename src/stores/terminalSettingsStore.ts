import { create } from "zustand";
import { persist } from "zustand/middleware";
import { touchAppSetting } from "./appSettingsTimestampStore";
import { clampScrollbackLines, DEFAULT_SCROLLBACK_LINES } from "./terminalSettingsUtils";

export const CURSOR_STYLES = ["bar", "block", "underline"] as const;
export type TerminalCursorStyle = (typeof CURSOR_STYLES)[number];
export const DEFAULT_CURSOR_STYLE: TerminalCursorStyle = "bar";

interface TerminalSettingsStore {
  preferredShell: string | null;
  scrollbackLines: number;
  cursorStyle: TerminalCursorStyle;
  setPreferredShell: (shell: string | null) => void;
  setScrollbackLines: (lines: number) => void;
  setCursorStyle: (style: TerminalCursorStyle) => void;
}

// Every setter reports its leaf; the settings registry decides whether it syncs.
const touchTerminal = (key: keyof TerminalSettingsStore) => touchAppSetting(`appSettings.terminal.${key}`);

export const useTerminalSettingsStore = create<TerminalSettingsStore>()(
  persist(
    (set) => ({
      preferredShell: null,
      scrollbackLines: DEFAULT_SCROLLBACK_LINES,
      cursorStyle: DEFAULT_CURSOR_STYLE,
      setPreferredShell: (shell) => { set({ preferredShell: shell }); touchTerminal("preferredShell"); },
      setScrollbackLines: (lines) => { set({ scrollbackLines: clampScrollbackLines(lines) }); touchTerminal("scrollbackLines"); },
      setCursorStyle: (style) => { set({ cursorStyle: style }); touchTerminal("cursorStyle"); },
    }),
    {
      name: "voltius-terminal-settings",
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<TerminalSettingsStore>) };
        state.scrollbackLines = clampScrollbackLines(state.scrollbackLines);
        if (!CURSOR_STYLES.includes(state.cursorStyle)) state.cursorStyle = DEFAULT_CURSOR_STYLE;
        return state;
      },
    },
  ),
);
