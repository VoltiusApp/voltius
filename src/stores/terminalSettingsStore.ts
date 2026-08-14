import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";
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

export const useTerminalSettingsStore = create<TerminalSettingsStore>()(
  persist(
    (set) => ({
      preferredShell: null,
      scrollbackLines: DEFAULT_SCROLLBACK_LINES,
      cursorStyle: DEFAULT_CURSOR_STYLE,
      setPreferredShell: (shell) => { set({ preferredShell: shell }); useAppSettingsTimestampStore.getState().touch(); },
      setScrollbackLines: (lines) => { set({ scrollbackLines: clampScrollbackLines(lines) }); useAppSettingsTimestampStore.getState().touch(); },
      setCursorStyle: (style) => { set({ cursorStyle: style }); useAppSettingsTimestampStore.getState().touch(); },
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
