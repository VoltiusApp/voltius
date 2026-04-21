import { useState } from "react";
import { Icon } from "@iconify/react";
import { useConnectionStore } from "@/stores/connectionStore";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { DashboardHostCard } from "./DashboardHostCard";
import type { Connection } from "@/types";

const PAGE_SIZE = 6;

function selectHosts(connections: Connection[]): Connection[] {
  const pinned = connections.filter((c) => c.pinned);
  const used = connections
    .filter((c) => !c.pinned && c.last_used_at)
    .sort((a, b) => (b.last_used_at ?? "").localeCompare(a.last_used_at ?? ""));
  return [...pinned, ...used];
}

interface Props {
  onSeeAll: () => void;
}

export function RecentHostsSection({ onSeeAll }: Props) {
  const connections = useConnectionStore((s) => s.connections);
  const connect = useSessionStore((s) => s.connect);
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  const [page, setPage] = useState(0);

  const handleConnect = (conn: Connection) => {
    connect(conn.id).catch(() => {});
    setActiveNav("terminal" as any);
  };

  const hosts = selectHosts(connections);
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
          Recent Hosts
        </h2>
        <button
          className="text-xs transition-colors"
          style={{ color: "var(--t-text-dim)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-accent)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-dim)")}
          onClick={onSeeAll}
        >
          See all
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          className="flex items-center justify-center w-6 h-6 rounded-lg transition-opacity shrink-0"
          style={{
            color: "var(--t-text-dim)",
            opacity: canPrev ? 1 : 0,
            pointerEvents: canPrev ? "auto" : "none",
          }}
          onClick={() => setPage((p) => p - 1)}
          aria-label="Previous page"
        >
          <Icon icon="lucide:chevron-left" width={16} />
        </button>

        <div className="flex gap-3 flex-1">
          {pageHosts.map((conn) => (
            <DashboardHostCard
              key={conn.id}
              connection={conn}
              onConnect={handleConnect}
            />
          ))}
        </div>

        <button
          className="flex items-center justify-center w-6 h-6 rounded-lg transition-opacity shrink-0"
          style={{
            color: "var(--t-text-dim)",
            opacity: canNext ? 1 : 0,
            pointerEvents: canNext ? "auto" : "none",
          }}
          onClick={() => setPage((p) => p + 1)}
          aria-label="Next page"
        >
          <Icon icon="lucide:chevron-right" width={16} />
        </button>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-center gap-1 mt-3">
          {Array.from({ length: totalPages }).map((_, i) => (
            <button
              key={i}
              className="w-1.5 h-1.5 rounded-full transition-all"
              style={{
                background: i === page ? "var(--t-accent)" : "var(--t-border-hover)",
                opacity: i === page ? 1 : 0.5,
              }}
              onClick={() => setPage(i)}
              aria-label={`Page ${i + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
