import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { DashboardHostCard } from "./DashboardHostCard";
import { useEffectivePinnedPredicate } from "@/hooks/useEffectivePinned";
import { pinnedThenRecent } from "@/utils/recentHosts";
import type { Connection } from "@/types";

const PAGE_SIZE = 6;

interface Props {
  onSeeAll: () => void;
}

function PageChevron({ dir, enabled, label, onClick }: { dir: "left" | "right"; enabled: boolean; label: string; onClick: () => void }) {
  return (
    <button
      className={`flex items-center justify-center w-6 h-6 rounded-lg transition-opacity shrink-0 text-(--t-text-dim) ${enabled ? "" : "opacity-0 pointer-events-none"}`}
      tabIndex={enabled ? 0 : -1}
      aria-hidden={!enabled}
      onClick={onClick}
      aria-label={label}
    >
      <Icon icon={dir === "left" ? "lucide:chevron-left" : "lucide:chevron-right"} width={16} />
    </button>
  );
}

export function RecentHostsSection({ onSeeAll }: Props) {
  const { t } = useTranslation();
  const connections = useAllConnections();
  const connect = useSessionStore((s) => s.connect);
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  const [page, setPage] = useState(0);

  const handleConnect = (conn: Connection) => {
    connect(conn.id).catch(() => {});
    setActiveNav("terminal");
  };

  const isPinnedFn = useEffectivePinnedPredicate();
  const hosts = pinnedThenRecent(connections, (c) => isPinnedFn(c, "connection"), true);
  if (hosts.length === 0) return null;

  const totalPages = Math.ceil(hosts.length / PAGE_SIZE);
  const pageHosts = hosts.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const canPrev = page > 0;
  const canNext = page < totalPages - 1;

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

      <div className="flex items-center gap-2">
        <PageChevron dir="left" enabled={canPrev} label={t("home.recentHosts.prevPage")} onClick={() => setPage((p) => p - 1)} />

        <div className="flex gap-3 flex-1">
          {pageHosts.map((conn) => (
            <DashboardHostCard
              key={conn.id}
              connection={conn}
              onConnect={handleConnect}
            />
          ))}
        </div>

        <PageChevron dir="right" enabled={canNext} label={t("home.recentHosts.nextPage")} onClick={() => setPage((p) => p + 1)} />
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-1 mt-3">
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              className="w-1.5 h-1.5 rounded-full transition-all"
              style={{
                background: i === page ? "var(--t-accent)" : "var(--t-text-dim)",
                opacity: i === page ? 1 : 0.5,
              }}
              onClick={() => setPage(i)}
              aria-label={t("home.recentHosts.pageNumber", { number: i + 1 })}
            />
          ))}
        </div>
      )}
    </div>
  );
}
