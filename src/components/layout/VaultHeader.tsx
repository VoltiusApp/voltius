import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useVaultStore } from "@/stores/vaultStore";
import { useUIStore } from "@/stores/uiStore";
import { useConnectionStore } from "@/stores/connectionStore";
import { useKeyStore } from "@/stores/keyStore";
import { useTeamStore } from "@/stores/teamStore";
import { getSyncState, onSyncStateChange } from "@/services/sync";
import { getAccountMode } from "@/services/account";

function relativeTime(date: Date | null): string | null {
  if (!date) return null;
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export default function VaultHeader() {
  const vaults = useVaultStore((s) => s.vaults);
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const setOmniOpen = useUIStore((s) => s.setOmniOpen);
  const connections = useConnectionStore((s) => s.connections);
  const keys = useKeyStore((s) => s.keys);
  const { teams, membersByTeam, loadMembers } = useTeamStore();

  const [syncState, setSyncState] = useState(getSyncState);
  useEffect(() => onSyncStateChange(() => setSyncState(getSyncState())), []);

  const [accountMode, setAccountMode] = useState<string | null>(null);
  useEffect(() => { getAccountMode().then(setAccountMode).catch(() => {}); }, []);

  // Use the first selected vault as the "active" vault
  const activeVaultId = selectedVaultIds[0] ?? null;
  const vault = vaults.find((v) => v.id === activeVaultId) ?? null;
  const team = vault?.teamId ? teams.find((t) => t.id === vault.teamId) ?? null : null;
  const members = team ? (membersByTeam[team.id] ?? null) : null;

  // Load members if team is found but members aren't loaded yet
  useEffect(() => {
    if (team && !membersByTeam[team.id]) {
      loadMembers(team.id).catch(() => {});
    }
  }, [team?.id]);

  if (!vault) return null;

  const initial = vault.name.trim().charAt(0).toUpperCase();
  const isE2EE = accountMode === "local";
  const hostCount = connections.length;
  const keyCount = keys.length;
  const lastSync = relativeTime(syncState.lastSync);
  const showSync = syncState.cloudActive && lastSync;

  return (
    <div
      className="flex items-center shrink-0 px-4 gap-4 border-b"
      style={{
        height: "3.75rem",
        background: "var(--t-bg-sidebar)",
        borderColor: "var(--t-bg-card-hover)",
      }}
    >
      {/* Vault icon */}
      <div
        className="flex items-center justify-center shrink-0 rounded-xl text-base font-bold text-white"
        style={{
          width: 40,
          height: 40,
          background: "var(--t-accent)",
        }}
      >
        {initial}
      </div>

      {/* Vault info */}
      <div className="flex flex-col justify-center min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-base font-semibold truncate" style={{ color: "var(--t-text-primary)" }}>
            {vault.name}
          </span>
          {team && (
            <Badge label="team" />
          )}
          {members !== null && (
            <Badge label={`${members.length} member${members.length !== 1 ? "s" : ""}`} accent />
          )}
        </div>
        <div className="flex items-center gap-3 text-xs mt-0.5 flex-wrap" style={{ color: "var(--t-text-dim)" }}>
          {isE2EE && (
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--t-status-connected)" }} />
              E2EE
            </span>
          )}
          {hostCount > 0 && (
            <span>{hostCount} host{hostCount !== 1 ? "s" : ""}</span>
          )}
          {keyCount > 0 && (
            <span>{keyCount} key{keyCount !== 1 ? "s" : ""}</span>
          )}
          {showSync && (
            <span>Last sync {lastSync}</span>
          )}
        </div>
      </div>

      {/* Jump to omnibar */}
      <button
        onClick={() => setOmniOpen(true)}
        className="flex items-center gap-2 px-3 h-9 rounded-lg shrink-0 transition-colors"
        style={{
          background: "var(--t-bg-input)",
          color: "var(--t-text-dim)",
          border: "1px solid var(--t-border)",
          minWidth: 180,
        }}
        onMouseEnter={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-accent)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)";
        }}
        onMouseLeave={(e) => {
          (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--t-border)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-dim)";
        }}
      >
        <Icon icon="lucide:search" width={14} className="shrink-0" />
        <span className="text-sm flex-1 text-left">Jump to...</span>
        <kbd
          className="flex items-center gap-0.5 text-[10px] px-1 rounded"
          style={{ background: "var(--t-bg-elevated)", color: "var(--t-text-dim)" }}
        >
          <span>⌘</span>
          <span>K</span>
        </kbd>
      </button>
    </div>
  );
}

function Badge({ label, accent }: { label: string; accent?: boolean }) {
  return (
    <span
      className="px-2 py-0.5 rounded-full text-xs font-medium shrink-0"
      style={{
        background: accent
          ? "color-mix(in srgb, var(--t-accent) 15%, transparent)"
          : "var(--t-bg-elevated)",
        color: accent ? "var(--t-accent)" : "var(--t-text-secondary)",
        border: accent
          ? "1px solid color-mix(in srgb, var(--t-accent) 30%, transparent)"
          : "1px solid var(--t-border)",
      }}
    >
      {label}
    </span>
  );
}
