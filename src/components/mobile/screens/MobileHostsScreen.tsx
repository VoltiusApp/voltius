import { useMemo } from "react";
import { Icon } from "@iconify/react";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useVaultStore } from "@/stores/vaultStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import MobileHeader from "../MobileHeader";
import MobileRemoteDeviceSessions from "../MobileRemoteDeviceSessions";

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
    return [...filtered].sort((a, b) => connectionDisplayName(a).localeCompare(connectionDisplayName(b)));
  }, [connections, selectedVaultIds, search]);

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
        {visible.map((c) => {
          const named = !!c.name?.trim();
          const subtitle = `${c.username}@${c.host}${c.port !== 22 ? `:${c.port}` : ""}`;
          return (
            <div key={c.id} className="flex items-center" data-mobile-host={c.id}>
              <button
                className="flex-1 flex items-center gap-3 px-4 py-3 text-left active:bg-(--t-bg-card)"
                onClick={() => handleConnect(c.id)}
              >
                <ConnectionAvatar connection={c} size={34} />
                <span className="flex flex-col min-w-0">
                  <span className="text-sm font-medium text-(--t-text-primary) truncate">
                    {connectionDisplayName(c)}
                  </span>
                  {/* Unnamed hosts already show "user@host" as their display name — don't repeat it. */}
                  {named && (
                    <span className="text-xs text-(--t-text-dim) truncate">{subtitle}</span>
                  )}
                </span>
              </button>
              <button
                data-mobile-host-actions={c.id}
                className="p-3 text-(--t-text-dim)"
                onClick={() => openSheet({ kind: "host-actions", hostId: c.id })}
              >
                <Icon icon="lucide:ellipsis-vertical" width={18} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
