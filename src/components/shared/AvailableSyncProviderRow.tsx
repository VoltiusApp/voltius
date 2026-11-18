import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { catalogIcon } from "@/plugins/catalogIcon";
import { InstallButton } from "@/components/shared/InstallButton";
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
        <InstallButton
          label={t(busy ? "settings.plugins.browse.installing" : "settings.plugins.browse.install")}
          busy={busy}
          onClick={onInstall}
          compact={compact}
        />
      )}
    </div>
  );
}
