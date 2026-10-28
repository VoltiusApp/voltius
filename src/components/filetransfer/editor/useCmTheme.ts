import { useMemo } from "react";
import type { Extension } from "@codemirror/state";
import { useThemeStore } from "@/stores/themeStore";
import type { AppTheme } from "@/themes/types";
import { cmTheme, inlineSyntax, type InlineSyntax } from "./cmTheme";

function useActiveThemeDerived<T>(derive: (theme: AppTheme) => T): T {
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const customThemes = useThemeStore((s) => s.customThemes);
  const getActiveTheme = useThemeStore((s) => s.getActiveTheme);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => derive(getActiveTheme()), [activeThemeId, customThemes, derive]);
}

export const useCmTheme = (): Extension[] => useActiveThemeDerived(cmTheme);
export const useInlineSyntax = (): InlineSyntax => useActiveThemeDerived(inlineSyntax);
