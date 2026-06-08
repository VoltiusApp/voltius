import { Icon } from "@iconify/react";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useVaultStore } from "@/stores/vaultStore";
import { useUIStore } from "@/stores/uiStore";
import { useSessionStore } from "@/stores/sessionStore";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { useEffectivePinnedPredicate } from "@/hooks/useEffectivePinned";
import type { Connection } from "@/types";

const HOSTS_PER_VAULT = 6;

function displayName(c: Connection): string {
  if (c.name?.trim()) return c.name.trim();
  if (c.connection_type === "serial" || c.serial_port) return c.serial_port ?? "Serial";
  return `${c.username}@${c.host}`;
}

function topHosts(
  connections: Connection[],
  isPinned: (c: Connection) => boolean,
): Connection[] {
  const pinned = connections.filter((c) => isPinned(c));
  const rest = connections
    .filter((c) => !isPinned(c))
    .sort((a, b) => (b.last_used_at ?? "").localeCompare(a.last_used_at ?? ""));
  return [...pinned, ...rest].slice(0, HOSTS_PER_VAULT);
}

interface VaultCardProps {
  name: string;
  hosts: Connection[];
  totalHosts: number;
  onConnect: (conn: Connection) => void;
}

function VaultCard({ name, hosts, totalHosts, onConnect }: VaultCardProps) {
  const hidden = totalHosts - hosts.length;
  return (
    <div className="surface-glass flex flex-col rounded-2xl p-4 gap-3">
      <div className="flex items-center gap-2">
        <Icon icon="lucide:vault" width={13} style={{ color: "var(--t-text-dim)" }} />
        <span className="text-xs font-semibold" style={{ color: "var(--t-text-secondary)" }}>
          {name}
        </span>
        <span className="ml-auto text-[10px]" style={{ color: "var(--t-text-dim)" }}>
          {totalHosts} host{totalHosts !== 1 ? "s" : ""}
        </span>
      </div>

      {hosts.length === 0 ? (
        <p className="text-xs py-4 text-center" style={{ color: "var(--t-text-dim)" }}>
          No hosts yet
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {hosts.map((conn) => (
            <button
              key={conn.id}
              onClick={() => onConnect(conn)}
              className="group flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors w-full"
              style={{ color: "var(--t-text-primary)" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-elevated)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              <ConnectionAvatar connection={conn} size={24} />
              <span className="flex-1 text-xs font-medium truncate">{displayName(conn)}</span>
              <Icon
                icon="lucide:terminal"
                width={12}
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                style={{ color: "var(--t-text-dim)" }}
              />
            </button>
          ))}
          {hidden > 0 && (
            <p className="text-[10px] px-2 pt-1" style={{ color: "var(--t-text-dim)" }}>
              +{hidden} more
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function VaultsOverview() {
  const connections = useAllConnections();
  const vaults = useVaultStore((s) => s.vaults);
  const connect = useSessionStore((s) => s.connect);
  const setActiveNav = useUIStore((s) => s.setActiveNav);
  const setHomeView = useUIStore((s) => s.setHomeView);

  const handleConnect = (conn: Connection) => {
    connect(conn.id).catch(() => {});
    setHomeView(false);
    setActiveNav("terminal");
  };

  const isPinnedFn = useEffectivePinnedPredicate();
  const sections = vaults.map((vault) => {
    const vaultConns = connections.filter((c) => (c.vault_id ?? "personal") === vault.id);
    return {
      vault,
      hosts: topHosts(vaultConns, (c) => isPinnedFn(c, "connection")),
      totalHosts: vaultConns.length,
    };
  });

  if (sections.length === 0) return null;

  return (
    <div className="mb-8">
      <h2
        className="text-xs font-bold uppercase tracking-widest mb-4"
        style={{ color: "var(--t-text-dim)" }}
      >
        Vaults
      </h2>
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(14rem, 1fr))" }}>
        {sections.map(({ vault, hosts, totalHosts }) => (
          <VaultCard
            key={vault.id}
            name={vault.name}
            hosts={hosts}
            totalHosts={totalHosts}
            onConnect={handleConnect}
          />
        ))}
      </div>
    </div>
  );
}
