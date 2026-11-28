import { useMemo } from "react";
import type { Extension } from "@codemirror/state";
import { useThemeStore } from "@/stores/themeStore";
import type { AppTheme } from "@/themes/types";
import { cmFind } from "./cmFind";
import { cmTheme, inlineSyntax, type InlineSyntax } from "./cmTheme";

function useActiveThemeDerived<T>(derive: (theme: AppTheme) => T): T {
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const customThemes = useThemeStore((s) => s.customThemes);
  const getActiveTheme = useThemeStore((s) => s.getActiveTheme);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => derive(getActiveTheme()), [activeThemeId, customThemes, derive]);
}

// basicSetup only appends search on Ctrl+F, and react-codemirror's reconfigure on re-render dropped it.
const cmBase = (theme: AppTheme): Extension[] => [...cmTheme(theme), cmFind];

export const useCmTheme = (): Extension[] => useActiveThemeDerived(cmBase);
export const useInlineSyntax = (): InlineSyntax => useActiveThemeDerived(inlineSyntax);
