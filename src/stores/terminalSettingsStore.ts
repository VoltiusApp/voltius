import { create } from "zustand";
import { persist } from "zustand/middleware";

interface TerminalSettingsStore {
  preferredShell: string | null;
  setPreferredShell: (shell: string | null) => void;
}

export const useTerminalSettingsStore = create<TerminalSettingsStore>()(
  persist(
    (set) => ({
      preferredShell: null,
      setPreferredShell: (shell) => set({ preferredShell: shell }),
    }),
    { name: "voltius-terminal-settings" },
  ),
);
