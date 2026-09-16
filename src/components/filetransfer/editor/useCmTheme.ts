import { useMemo } from "react";
import type { Extension } from "@codemirror/state";
import { useThemeStore } from "@/stores/themeStore";
import { cmTheme } from "./cmTheme";

export function useCmTheme(): Extension[] {
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const customThemes = useThemeStore((s) => s.customThemes);
  const getActiveTheme = useThemeStore((s) => s.getActiveTheme);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => cmTheme(getActiveTheme()), [activeThemeId, customThemes]);
}
