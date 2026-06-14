import { useMemo } from "react";
import { Icon } from "@iconify/react";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useVaultStore } from "@/stores/vaultStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { useHostPingStore } from "@/stores/hostPingStore";
import { useEffectivePinnedPredicate } from "@/hooks/useEffectivePinned";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { StatusDot } from "@/components/shared/StatusDot";
import type { Connection } from "@/types";
import MobileHeader from "../MobileHeader";
import MobileRemoteDeviceSessions from "../MobileRemoteDeviceSessions";

function MobileHostRow({
  c,
  pinned,
  pingEnabled,
  onConnect,
  onActions,
}: {
  c: Connection;
  pinned: boolean;
  pingEnabled: boolean;
  onConnect: (id: string) => void;
  onActions: (id: string) => void;
}) {
  const pingStatus = useHostPingStore((s) => s.statuses[c.id]);
  const pingLatency = useHostPingStore((s) => s.latencies[c.id]);

  const isSerial = c.connection_type === "serial";
  const showPingDot = !isSerial && pingEnabled && !c.ping_disabled;
  const pingColor =
    pingStatus === "up"
      ? "var(--t-status-connected)"
      : pingStatus === "down"
      ? "var(--t-status-error)"
      : "var(--t-text-dim)";

  const named = !!c.name?.trim();
  const base = `${c.username}@${c.host}${c.port !== 22 ? `:${c.port}` : ""}`;
  const latency = showPingDot && pingStatus === "up" && pingLatency !== undefined ? ` · ${pingLatency}ms` : "";
  const subtitle = named ? `${base}${latency}` : latency.replace(/^ · /, "");

  return (
    <div className="flex items-center" data-mobile-host={c.id}>
      <button
        className="flex-1 flex items-center gap-3 px-4 py-3 text-left active:bg-(--t-bg-card)"
        onClick={() => onConnect(c.id)}
      >
        <span className="relative shrink-0">
          <ConnectionAvatar connection={c} size={34} />
          {showPingDot && <StatusDot color={pingColor} animate={pingStatus === "up"} size={9} />}
        </span>
        <span className="flex flex-col min-w-0">
          <span className="flex items-center gap-1.5 min-w-0">
            <span className="text-sm font-medium text-(--t-text-primary) truncate">
              {connectionDisplayName(c)}
            </span>
            {pinned && <Icon icon="lucide:pin" width={12} className="shrink-0 text-(--t-accent)" />}
          </span>
          {/* Unnamed hosts already show "user@host" as their display name — don't repeat it. */}
          {subtitle && <span className="text-xs text-(--t-text-dim) truncate">{subtitle}</span>}
        </span>
      </button>
      <button
        data-mobile-host-actions={c.id}
        className="p-3 text-(--t-text-dim)"
        onClick={() => onActions(c.id)}
      >
        <Icon icon="lucide:ellipsis-vertical" width={18} />
      </button>
    </div>
  );
}

export default function MobileHostsScreen() {
  const connections = useAllConnections();
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const connect = useSessionStore((s) => s.connect);
  const setTab = useMobileNavStore((s) => s.setTab);
  const push = useMobileNavStore((s) => s.push);
  const openSheet = useMobileNavStore((s) => s.openSheet);
  // Persisted in the nav store so the query survives tab switches (the screen unmounts).
  const search = useMobileNavStore((s) => s.hostSearch);
  const setSearch = useMobileNavStore((s) => s.setHostSearch);
  const [pingEnabled] = useToggle("reachability");
  const isPinnedFn = useEffectivePinnedPredicate();

  const visible = useMemo(() => {
    const inVault = connections.filter(
      (c) => !c.deleted_at && selectedVaultIds.includes(c.vault_id ?? "personal"),
    );
    const q = search.trim().toLowerCase();
    const filtered = q
      ? inVault.filter((c) =>
          connectionDisplayName(c).toLowerCase().includes(q) ||
          c.host.toLowerCase().includes(q) ||
          (c.tags ?? []).some((t) => t.toLowerCase().includes(q)))
      : inVault;
    const sorted = [...filtered].sort((a, b) => connectionDisplayName(a).localeCompare(connectionDisplayName(b)));
    // Pinned float to the top, alpha order preserved within each group (desktop parity).
    const pinned = sorted.filter((c) => isPinnedFn(c, "connection"));
    const rest = sorted.filter((c) => !isPinnedFn(c, "connection"));
    return [...pinned, ...rest];
  }, [connections, selectedVaultIds, search, isPinnedFn]);

  const handleConnect = (id: string) => {
    void connect(id).catch(console.error);
    setTab("terminal");
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <MobileHeader onAdd={() => push({ kind: "host-edit" })} />
      <div className="shrink-0 px-3 py-2">
        <div
          className="flex items-center gap-2 rounded-xl px-3 h-10"
          style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }}
        >
          <Icon icon="lucide:search" width={16} className="text-(--t-text-dim)" />
          <input
            data-mobile-host-search
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search hosts"
            className="flex-1 bg-transparent text-sm outline-none text-(--t-text-primary)"
          />
          {search && (
            <button
              data-mobile-host-search-clear
              onClick={() => setSearch("")}
              className="p-0.5 -mr-1 text-(--t-text-dim) active:text-(--t-text-primary)"
              aria-label="Clear search"
            >
              <Icon icon="lucide:x" width={16} />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <MobileRemoteDeviceSessions />
        {visible.length === 0 && (
          <div className="flex flex-col items-center gap-2 pt-16 text-(--t-text-dim)">
            <Icon icon="lucide:server-off" width={28} />
            <span className="text-sm">{search ? "No matches" : "No hosts yet — tap + to add one"}</span>
          </div>
        )}
        {visible.map((c) => (
          <MobileHostRow
            key={c.id}
            c={c}
            pinned={isPinnedFn(c, "connection")}
            pingEnabled={pingEnabled}
            onConnect={handleConnect}
            onActions={(id) => openSheet({ kind: "host-actions", hostId: id })}
          />
        ))}
      </div>
    </div>
  );
}
