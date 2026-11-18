import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { TOGGLE_DEFS, type ToggleId } from "@/stores/toggleDefs";
import { useIsAndroid, useIsMobile } from "@/utils/platform";
import { pluginLock, usePluginRegistryStore } from "@/stores/pluginRegistryStore";
import { getLoadedPlugins } from "@/plugins/runtime";
import { applyPluginEnabled } from "@/plugins/applyPluginEnabled";
import { useMarketplaceStore } from "@/stores/marketplaceStore";
import { pluginDefaultEnabled } from "@/plugins/pluginDefaultEnabled";
import { availableOn } from "@/components/settings/registry/defaults";
import { useSettingStates } from "@/components/settings/useChangedSettings";
import type { SettingDef } from "@/components/settings/registry/types";

export interface ToggleItem {
  id: string;
  label: string;
  icon: string;
  description?: string;
  keywords?: string[];
  value: boolean;
  locked?: boolean;
  onToggle: (v: boolean) => void;
}

const TOGGLE_PREFIX = "toggles.";
const SYNC_TYPE_PREFIX = "sync.type.";

/** Ids OmniSearch already used for these toggles, so recents keep resolving. */
function quickToggleId(key: string): string {
  if (key.startsWith(TOGGLE_PREFIX)) return key.slice(TOGGLE_PREFIX.length);
  if (key.startsWith(SYNC_TYPE_PREFIX)) return `sync-${key.slice(SYNC_TYPE_PREFIX.length)}`;
  if (key === "updater.autoUpdate") return "auto-update";
  return key;
}

function quickToggleIcon(def: SettingDef): string {
  if (def.key.startsWith(TOGGLE_PREFIX)) return TOGGLE_DEFS[def.key.slice(TOGGLE_PREFIX.length) as ToggleId]?.icon ?? "lucide:toggle-right";
  if (def.section === "sync") return "lucide:cloud";
  if (def.key === "updater.autoUpdate") return "lucide:refresh-cw";
  return "lucide:toggle-right";
}

export function useToggleSettings(): ToggleItem[] {
  const { t } = useTranslation();
  const states = useSettingStates();
  const pluginOverrides = usePluginRegistryStore((s) => s.overrides);
  const installedMeta = useMarketplaceStore((s) => s.installedMeta);
  const isMobile = useIsMobile();
  const isAndroid = useIsAndroid();

  const toggles = states.filter((s) => s.def.control.kind === "toggle" && s.def.set && availableOn(s.def, { isMobile, isAndroid }));
  // `toggles` is rebuilt every render; its signature is what changes the list.
  const signature = toggles.map((s) => `${s.def.key}=${String(s.value)}:${s.locked}`).join("|");
  const settings = useMemo(() => toggles.map((s): ToggleItem => ({
    id: quickToggleId(s.def.key),
    label: s.def.section === "sync"
      ? t("settings.sync.quickToggleLabel", { label: t(s.def.labelKey) })
      : t(s.def.labelKey),
    icon: quickToggleIcon(s.def),
    description: s.locked ? t("common.policy.managed") : t(`settings.nav.${s.def.section}.label`),
    keywords: [...(s.def.keywords ?? [])],
    value: !!s.value,
    locked: s.locked,
    onToggle: (v: boolean) => s.def.set?.(v),
  })), [signature, t]);

  const plugins = useMemo<ToggleItem[]>(() => getLoadedPlugins().map((m) => {
    const lock = pluginLock(m.id);
    return {
      id: `plugin:${m.id}`,
      label: m.name,
      icon: "lucide:puzzle",
      description: lock === null ? t("settings.plugins.categoryLabel") : t("common.policy.managed"),
      keywords: ["plugin", "extension", m.name.toLowerCase(), m.id],
      value: lock ?? pluginOverrides[m.id] ?? pluginDefaultEnabled(m, installedMeta),
      locked: lock !== null,
      onToggle: (v: boolean) => void applyPluginEnabled(m.id, v),
    };
  }), [t, pluginOverrides, installedMeta]);

  return useMemo(() => [...settings, ...plugins], [settings, plugins]);
}
