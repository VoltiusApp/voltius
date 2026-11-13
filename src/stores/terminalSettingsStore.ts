import { create } from "zustand";
import { persist } from "zustand/middleware";
import { writeAndTouch, writeAndTouchUnlessLocked } from "./appSettingsTimestampStore";
import { clampScrollbackLines, DEFAULT_SCROLLBACK_LINES, LEGACY_DEFAULT_SCROLLBACK_LINES } from "./terminalSettingsUtils";
import { storeSetting } from "@/services/policy/effectiveCore";
import { DEFAULT_KEYWORD_RULES, sanitizeKeywordRules, type KeywordRule } from "@/utils/keywordMatcher";

export const CURSOR_STYLES = ["bar", "block", "underline"] as const;
export type TerminalCursorStyle = (typeof CURSOR_STYLES)[number];
export const DEFAULT_CURSOR_STYLE: TerminalCursorStyle = "bar";

interface TerminalSettingsStore {
  preferredShell: string | null;
  scrollbackLines: number;
  cursorStyle: TerminalCursorStyle;
  keywordRules: KeywordRule[];
  setPreferredShell: (shell: string | null) => void;
  setScrollbackLines: (lines: number) => void;
  setCursorStyle: (style: TerminalCursorStyle) => void;
  setKeywordRules: (rules: KeywordRule[]) => void;
}

// Every setter reports its leaf; the settings registry decides whether it syncs.
const terminalKey = (key: keyof TerminalSettingsStore) => `appSettings.terminal.${key}`;
const unlessLocked = (key: keyof TerminalSettingsStore, write: () => void) => writeAndTouchUnlessLocked(terminalKey(key), write);

export function migrateTerminalSettings(persisted: unknown, version: number): unknown {
  const state = (persisted ?? {}) as { scrollbackLines?: number };
  if (version < 1 && state.scrollbackLines === LEGACY_DEFAULT_SCROLLBACK_LINES) state.scrollbackLines = DEFAULT_SCROLLBACK_LINES;
  return state;
}

export const useTerminalSettingsStore = create<TerminalSettingsStore>()(
  persist(
    (set) => ({
      preferredShell: null,
      scrollbackLines: DEFAULT_SCROLLBACK_LINES,
      cursorStyle: DEFAULT_CURSOR_STYLE,
      keywordRules: DEFAULT_KEYWORD_RULES,
      setPreferredShell: (shell) => unlessLocked("preferredShell", () => set({ preferredShell: shell })),
      setScrollbackLines: (lines) => unlessLocked("scrollbackLines", () => set({ scrollbackLines: clampScrollbackLines(lines) })),
      setCursorStyle: (style) => unlessLocked("cursorStyle", () => set({ cursorStyle: style })),
      setKeywordRules: (rules) => writeAndTouch(terminalKey("keywordRules"), () => set({ keywordRules: sanitizeKeywordRules(rules) })),
    }),
    {
      name: "voltius-terminal-settings",
      version: 1,
      migrate: (persisted, version) => migrateTerminalSettings(persisted, version) as TerminalSettingsStore,
      merge: (persisted, current) => {
        const state = { ...current, ...(persisted as Partial<TerminalSettingsStore>) };
        state.scrollbackLines = clampScrollbackLines(state.scrollbackLines);
        if (!CURSOR_STYLES.includes(state.cursorStyle)) state.cursorStyle = DEFAULT_CURSOR_STYLE;
        state.keywordRules = sanitizeKeywordRules(state.keywordRules);
        return state;
      },
    },
  ),
);

export const cursorStyleSetting = storeSetting(useTerminalSettingsStore, "cursorStyle", terminalKey("cursorStyle"));
export const preferredShellSetting = storeSetting(useTerminalSettingsStore, "preferredShell", terminalKey("preferredShell"));
export const keywordRulesSetting = storeSetting(useTerminalSettingsStore, "keywordRules", terminalKey("keywordRules"));
