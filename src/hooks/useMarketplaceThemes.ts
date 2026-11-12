import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useBrowseCatalog } from "@/hooks/useBrowseCatalog";
import { usePluginInstaller } from "@/components/settings/usePluginInstaller";
import { getLoadedPlugins } from "@/plugins/runtime";
import { FIRST_PARTY_SOURCE, useMarketplaceStore, type MarketplacePlugin } from "@/stores/marketplaceStore";
import { usePluginStore } from "@/stores/pluginStore";
import { useInstallPolicy } from "@/stores/pluginRegistryStore";
import { useThemeStore } from "@/stores/themeStore";
import { DEFAULT_THEME_ID } from "@/themes/presets";
import type { AppTheme } from "@/themes/types";
import { useIsAndroid } from "@/utils/platform";
import {
  availableThemeEntries, isThemeOnly, parsePreview, pluginThemeIdsFor, type ThemePreviewPalette,
} from "@/themes/marketplaceThemes";

export interface AvailableTheme {
  entry: MarketplacePlugin;
  preview: ThemePreviewPalette | null;
  sourceName: string | null;
  disabledReason: string | null;
}

export interface ThemeRemoval {
  disabledReason: string | null;
  remove(): void;
}

export function useMarketplaceThemes(): {
  available: AvailableTheme[];
  loading: boolean;
  unreachableCount: number;
  busy: Set<string>;
  get(theme: AvailableTheme): void;
  removal(theme: AppTheme): ThemeRemoval | null;
  modal: ReactNode;
} {
  const { t } = useTranslation();
  const { merged, installedIds } = useBrowseCatalog();
  const sources = useMarketplaceStore((s) => s.sources);
  const sourceErrors = useMarketplaceStore((s) => s.sourceErrors);
  const catalogLoading = useMarketplaceStore((s) => s.catalogLoading);
  const pluginThemes = usePluginStore((s) => s.pluginThemes);
  const installAllowed = useInstallPolicy();
  const isAndroid = useIsAndroid();
  const { busy, startInstall, modal } = usePluginInstaller();

  const sourceNameOf = (entry: MarketplacePlugin) =>
    entry.sourceId === FIRST_PARTY_SOURCE.id || entry.builtin
      ? null
      : sources.find((s) => s.id === entry.sourceId)?.name ?? entry.sourceId;

  const disabledReasonOf = (entry: MarketplacePlugin) => {
    if (!installAllowed(entry.id)) return t("settings.plugins.browse.installsOff");
    if (isAndroid && entry.desktopOnly) return t("settings.appearance.marketplace.desktopOnly");
    return null;
  };

  const available = availableThemeEntries(merged, installedIds).map((entry) => ({
    entry,
    preview: parsePreview(entry.preview),
    sourceName: sourceNameOf(entry),
    disabledReason: disabledReasonOf(entry),
  }));

  const get = ({ entry, disabledReason }: AvailableTheme) => {
    if (disabledReason || busy.has(entry.id)) return;
    const activeAtClick = useThemeStore.getState().activeThemeId;
    startInstall(entry, () => {
      const [themeId] = pluginThemeIdsFor(usePluginStore.getState().pluginThemes, entry.id);
      const themes = useThemeStore.getState();
      if (themeId && themes.activeThemeId === activeAtClick) themes.setTheme(themeId);
    });
  };

  const dropActive = (themeIds: string[]) => {
    const themes = useThemeStore.getState();
    if (themeIds.includes(themes.activeThemeId)) themes.setTheme(DEFAULT_THEME_ID);
  };

  const removal = (theme: AppTheme): ThemeRemoval | null => {
    if (!pluginThemes.has(theme.id)) {
      if (theme.builtIn) return null;
      return {
        disabledReason: null,
        remove: () => { useThemeStore.getState().deleteCustomTheme(theme.id); dropActive([theme.id]); },
      };
    }
    const owner = getLoadedPlugins().find((m) => pluginThemeIdsFor(pluginThemes, m.id).includes(theme.id));
    if (!owner) return null;
    if (!isThemeOnly(owner)) {
      return { disabledReason: t("settings.appearance.marketplace.partOfPlugin", { plugin: owner.name }), remove: () => {} };
    }
    return {
      disabledReason: null,
      remove: () => {
        dropActive(pluginThemeIdsFor(pluginThemes, owner.id));
        void useMarketplaceStore.getState().uninstallSeededPlugin(owner.id);
      },
    };
  };

  return {
    available,
    loading: catalogLoading && available.length === 0,
    unreachableCount: sources.filter((s) => s.enabled && sourceErrors[s.id]).length,
    busy,
    get,
    removal,
    modal,
  };
}
