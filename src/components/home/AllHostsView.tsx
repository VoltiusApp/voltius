import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useAllConnections } from "@/hooks/useAllConnections";
import { DashboardHostCard } from "./DashboardHostCard";
import { useConnectFromHome } from "./hostDisplay";
import { cardGridProps } from "@/components/shared/cardGrid";
import { useEffectivePinnedPredicate } from "@/hooks/useEffectivePinned";
import { pinnedThenRecent } from "@/utils/recentHosts";

interface Props {
  onBack: () => void;
}

export function AllHostsView({ onBack }: Props) {
  const { t } = useTranslation();
  const connections = useAllConnections();
  const handleConnect = useConnectFromHome();

  const isPinnedFn = useEffectivePinnedPredicate();
  const hosts = pinnedThenRecent(connections, (c) => isPinnedFn(c, "connection"));

  return (
    <div className="h-full overflow-y-auto chrome-canvas focus-ring-scope">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="flex items-center gap-3 mb-8">
          <button
            className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors bg-(--t-bg-card) text-(--t-text-dim) hover:text-(--t-text-primary)"
            onClick={onBack}
            aria-label={t("home.allHosts.back")}
          >
            <Icon icon="lucide:chevron-left" width={16} />
          </button>
          <h1 className="text-xl font-semibold text-(--t-text-primary)">
            {t("home.allHosts.title")}
          </h1>
        </div>

        {hosts.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--t-text-dim)" }}>
            {t("home.allHosts.empty")}
          </p>
        ) : (
          <div {...cardGridProps("grid", "tile")}>
            {hosts.map((conn) => (
              <DashboardHostCard
                key={conn.id}
                connection={conn}
                onConnect={handleConnect}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
