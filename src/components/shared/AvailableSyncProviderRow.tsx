import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { catalogIcon } from "@/plugins/catalogIcon";
import { satisfiesMinAppVersion } from "@/plugins/version";
import type { MarketplacePlugin } from "@/stores/marketplaceStore";

export function AvailableSyncProviderRow({ plugin, appVersion, busy, onInstall, compact = false }: {
  plugin: MarketplacePlugin;
  appVersion: string | null;
  busy: boolean;
  onInstall: () => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const blocked = appVersion !== null && !satisfiesMinAppVersion(plugin, appVersion);

  return (
    <div
      data-available-sync-provider={plugin.id}
      className={compact ? "flex items-center justify-between gap-2" : "flex items-center justify-between gap-3 px-4 py-3"}
    >
      <div className={compact ? "flex items-center gap-1.5 min-w-0" : "flex items-center gap-2.5 min-w-0"}>
        <Icon icon={catalogIcon(plugin.icon, "lucide:puzzle")} width={compact ? 12 : 16} className="shrink-0 text-(--t-text-muted)" />
        <p className={compact ? "text-xs truncate text-(--t-text-secondary)" : "text-sm font-medium text-(--t-text-primary)"}>
          {plugin.name}
        </p>
      </div>
      {blocked ? (
        <span className="text-[10px] shrink-0 text-(--t-text-dim)">
          {t("settings.plugins.browse.requiresVersion", { version: plugin.minAppVersion })}
        </span>
      ) : (
        <button
          onClick={onInstall}
          disabled={busy}
          className={compact
            ? "flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-medium shrink-0 bg-(--t-bg-elevated) text-(--t-text-secondary) hover:text-(--t-text-primary) transition-colors"
            : "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 bg-(--t-accent) text-(--t-bg-base) transition-opacity hover:opacity-85"}
          style={{ opacity: busy ? 0.6 : undefined }}
        >
          <Icon icon={busy ? "lucide:loader" : "lucide:download"} width={compact ? 10 : 12} className={busy ? "animate-spin" : undefined} />
          {t(busy ? "settings.plugins.browse.installing" : "settings.plugins.browse.install")}
        </button>
      )}
    </div>
  );
}
