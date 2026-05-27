import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useAppSettingsTimestampStore } from "./appSettingsTimestampStore";
import { clampScrollbackLines, DEFAULT_SCROLLBACK_LINES } from "./terminalSettingsUtils";

interface TerminalSettingsStore {
  preferredShell: string | null;
  scrollbackLines: number;
  shellIntegrationEnabled: boolean;
  setPreferredShell: (shell: string | null) => void;
  setScrollbackLines: (lines: number) => void;
  setShellIntegrationEnabled: (enabled: boolean) => void;
}

export const useTerminalSettingsStore = create<TerminalSettingsStore>()(
  persist(
    (set) => ({
      preferredShell: null,
      scrollbackLines: DEFAULT_SCROLLBACK_LINES,
      shellIntegrationEnabled: true,
      setPreferredShell: (shell) => { set({ preferredShell: shell }); useAppSettingsTimestampStore.getState().touch(); },
      setScrollbackLines: (lines) => { set({ scrollbackLines: clampScrollbackLines(lines) }); useAppSettingsTimestampStore.getState().touch(); },
      setShellIntegrationEnabled: (enabled) => { set({ shellIntegrationEnabled: enabled }); useAppSettingsTimestampStore.getState().touch(); },
    }),
    {
      name: "voltius-terminal-settings",
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<TerminalSettingsStore>) };
        state.scrollbackLines = clampScrollbackLines(state.scrollbackLines);
        return state;
      },
    },
  ),
);
