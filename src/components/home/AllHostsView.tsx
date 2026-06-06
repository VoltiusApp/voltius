import { Icon } from "@iconify/react";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { DashboardHostCard } from "./DashboardHostCard";
import { useEffectivePinnedPredicate } from "@/hooks/useEffectivePinned";
import type { Connection } from "@/types";

function sortHosts(
  connections: Connection[],
  isPinned: (c: Connection) => boolean,
): Connection[] {
  const pinned = connections.filter((c) => isPinned(c));
  const remaining = [...connections.filter((c) => !isPinned(c))].sort((a, b) =>
    (b.last_used_at ?? "").localeCompare(a.last_used_at ?? ""),
  );
  return [...pinned, ...remaining];
}

interface Props {
  onBack: () => void;
}

export function AllHostsView({ onBack }: Props) {
  const connections = useAllConnections();
  const connect = useSessionStore((s) => s.connect);
  const setActiveNav = useUIStore((s) => s.setActiveNav);

  const handleConnect = (conn: Connection) => {
    connect(conn.id).catch(() => {});
    setActiveNav("terminal");
  };

  const isPinnedFn = useEffectivePinnedPredicate();
  const hosts = sortHosts(connections, (c) => isPinnedFn(c, "connection"));

  return (
    <div className="h-full overflow-y-auto bg-[var(--t-bg-base)]">
      <div className="max-w-4xl mx-auto px-8 py-8">
        <div className="flex items-center gap-3 mb-8">
          <button
            className="flex items-center justify-center w-7 h-7 rounded-lg transition-colors"
            style={{ color: "var(--t-text-dim)", background: "var(--t-bg-card)" }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--t-text-primary)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--t-text-dim)")}
            onClick={onBack}
            aria-label="Back"
          >
            <Icon icon="lucide:chevron-left" width={16} />
          </button>
          <h1
            className="text-sm font-bold uppercase tracking-widest"
            style={{ color: "var(--t-text-dim)" }}
          >
            All Hosts
          </h1>
        </div>

        {hosts.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--t-text-dim)" }}>
            No hosts yet.
          </p>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: "repeat(auto-fill, minmax(7.5rem, 1fr))" }}
          >
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
