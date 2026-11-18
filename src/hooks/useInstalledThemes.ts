import { usePluginStore } from "@/stores/pluginStore";
import { useThemeStore } from "@/stores/themeStore";
import { useSystemColorsStore } from "@/services/androidSystemColors";
import { BUILT_IN_THEMES } from "@/themes/presets";
import type { AppTheme } from "@/themes/types";
import { useIsAndroid } from "@/utils/platform";

export function useInstalledThemes(): AppTheme[] {
  const customThemes = useThemeStore((s) => s.customThemes);
  const pluginThemeMap = usePluginStore((s) => s.pluginThemes);
  const isAndroid = useIsAndroid();
  const systemPalette = useSystemColorsStore((s) => s.palette);
  useSystemColorsStore((s) => s.dark);
  const dynamicTheme = isAndroid && systemPalette ? useThemeStore.getState().getDynamicTheme() : null;
  const pluginThemes: AppTheme[] = [...pluginThemeMap.values()].map((theme) => ({ ...theme, builtIn: true }));
  return [...(dynamicTheme ? [dynamicTheme] : []), ...BUILT_IN_THEMES, ...customThemes, ...pluginThemes];
}
