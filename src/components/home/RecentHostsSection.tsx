import { useLayoutEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAllConnections } from "@/hooks/useAllConnections";
import { DashboardHostCard } from "./DashboardHostCard";
import { useConnectFromHome } from "./hostDisplay";
import { cardGridProps } from "@/components/shared/cardGrid";
import { useEffectivePinnedPredicate } from "@/hooks/useEffectivePinned";
import { pinnedThenRecent } from "@/utils/recentHosts";

const MAX_ROWS = 2;

interface Props {
  onSeeAll: () => void;
}

function useGridColumnCount(fallback: number) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [count, setCount] = useState(fallback);
  useLayoutEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const update = () => setCount(getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length || fallback);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el, fallback]);
  return [setEl, count] as const;
}

export function RecentHostsSection({ onSeeAll }: Props) {
  const { t } = useTranslation();
  const connections = useAllConnections();
  const handleConnect = useConnectFromHome();
  const isPinnedFn = useEffectivePinnedPredicate();
  const [gridRef, columns] = useGridColumnCount(6);

  const hosts = pinnedThenRecent(connections, (c) => isPinnedFn(c, "connection"), true);
  if (hosts.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <h2
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: "var(--t-text-dim)" }}
        >
          {t("home.recentHosts.title")}
        </h2>
        <button
          className="text-xs transition-colors text-(--t-text-dim) hover:text-(--t-accent)"
          onClick={onSeeAll}
        >
          {t("home.recentHosts.seeAll")}
        </button>
      </div>

      <div ref={gridRef} {...cardGridProps("grid", "tile")}>
        {hosts.slice(0, columns * MAX_ROWS).map((conn) => (
          <DashboardHostCard key={conn.id} connection={conn} onConnect={handleConnect} />
        ))}
      </div>
    </div>
  );
}
