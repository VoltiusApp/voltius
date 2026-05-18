import { useEffect, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useVaultStore } from "@/stores/vaultStore";
import { useUIStore } from "@/stores/uiStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useAllKeys } from "@/hooks/useAllKeys";
import { useAllPortForwardingRules } from "@/hooks/useAllPortForwardingRules";
import { useTeamStore } from "@/stores/teamStore";
import type { TeamMember, TeamRole } from "@/services/teamService";
import { StatusDot } from "@/components/shared/StatusDot";
import { MiniAvatar, avatarColor } from "@/components/shared/AvatarStack";
import { getSyncState, onSyncStateChange } from "@/services/sync";
import { getAccountMode } from "@/services/account";

// ─── Online members stack ─────────────────────────────────────────────────────

const BUILTIN_ROLE_COLORS: Record<string, string> = {
  owner: "#f59e0b",
  manager: "#8b5cf6",
  editor: "#3b82f6",
  member: "#10b981",
  "connect-only": "#6b7280",
};

const MAX_STACK = 3;

function OnlineMembersStack({ members, roles, onInviteClick }: { members: TeamMember[]; roles: TeamRole[]; onInviteClick: () => void }) {
  const [hovered, setHovered] = useState(false);
  const [invHovered, setInvHovered] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const visible = members.slice(0, MAX_STACK);
  const overflow = members.length - MAX_STACK;
  const onlineCount = members.filter((m) => m.is_online).length;

  return (
    <div className="flex items-center gap-2 shrink-0">
      {/* Stack */}
      {members.length > 0 && (
        <div
          ref={ref}
          className="relative flex items-center cursor-default"
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {visible.map((m, i) => (
            <div
              key={m.user_id}
              title={m.display_name}
              style={{
                marginLeft: i === 0 ? 0 : -9,
                zIndex: MAX_STACK - i,
                borderRadius: "50%",
                border: m.is_online
                  ? "2px solid var(--t-status-connected)"
                  : "2px solid transparent",
                boxShadow: "0 0 0 1.5px var(--t-bg-toolbar)",
                opacity: m.is_online ? 1 : 0.45,
                transition: "border-color 0.2s, opacity 0.2s",
              }}
            >
              <MiniAvatar name={m.display_name} size={24} />
            </div>
          ))}
          {overflow > 0 && (
            <div
              className="flex items-center justify-center text-[10px] font-semibold rounded-full shrink-0"
              style={{
                marginLeft: -9,
                zIndex: 0,
                width: 26,
                height: 26,
                background: "var(--t-bg-elevated)",
                border: "2px solid var(--t-bg-toolbar)",
                color: "var(--t-text-dim)",
              }}
            >
              +{overflow}
            </div>
          )}

          {/* Hover popover */}
          {hovered && (
            <div
              className="absolute top-full mt-2 left-0 z-50 rounded-xl overflow-hidden"
              style={{
                background: "var(--t-bg-card)",
                border: "1px solid var(--t-border)",
                boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
                minWidth: 190,
              }}
            >
              <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--t-border)" }}>
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "var(--t-text-dim)" }}>
                  {onlineCount > 0 ? `${onlineCount} online` : "no one online"}
                </span>
              </div>
              {members.map((m) => {
                const memberRoles = (m.role_ids ?? [])
                  .map((rid) => roles.find((r) => r.id === rid))
                  .filter(Boolean) as TeamRole[];
                return (
                  <div key={m.user_id} className="flex items-center gap-2.5 px-3 py-2" style={{ opacity: m.is_online ? 1 : 0.5 }}>
                    <div className="relative shrink-0">
                      <MiniAvatar name={m.display_name} size={22} />
                      {m.is_online && <StatusDot color="var(--t-status-connected)" size={7} />}
                    </div>
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-xs truncate" style={{ color: "var(--t-text-primary)" }}>{m.display_name}</span>
                      {memberRoles.length > 0 && (
                        <div className="flex items-center gap-1 flex-wrap mt-0.5">
                          {memberRoles.map((r) => {
                            const color = r.color ?? BUILTIN_ROLE_COLORS[r.name] ?? avatarColor(r.name);
                            return (
                              <span
                                key={r.id}
                                className="text-[9px] font-medium px-1 py-px rounded-full capitalize leading-none"
                                style={{ color, background: `${color}22` }}
                              >
                                {r.name}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Invite + button */}
      <button
        onClick={onInviteClick}
        onMouseEnter={() => setInvHovered(true)}
        onMouseLeave={() => setInvHovered(false)}
        title="Invite member"
        className="rounded-full flex items-center justify-center transition-all shrink-0"
        style={{
          width: 26,
          height: 26,
          border: `2px dashed ${invHovered ? "var(--t-accent)" : "var(--t-border)"}`,
          background: invHovered ? "rgba(var(--t-accent-rgb, 99,102,241), 0.1)" : "transparent",
          color: invHovered ? "var(--t-accent)" : "var(--t-text-dim)",
        }}
      >
        <Icon icon="lucide:plus" width={11} />
      </button>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
  const openMembersInvite = useUIStore((s) => s.openMembersInvite);
  const connections = useAllConnections();
  const keys = useAllKeys();
  const portRules = useAllPortForwardingRules();
  const { teams, membersByTeam, rolesByTeam, loadMembers } = useTeamStore();

  const [syncState, setSyncState] = useState(getSyncState);
  useEffect(() => onSyncStateChange(() => setSyncState(getSyncState())), []);

  const [accountMode, setAccountMode] = useState<string | null>(null);
  useEffect(() => { getAccountMode().then(setAccountMode).catch(() => {}); }, []);

  // Use the first selected vault as the "active" vault.
  // For non-owner team members there is no local vault — the sidebar sets a
  // team ID directly, so fall back to looking up in `teams`.
  const activeVaultId = selectedVaultIds[0] ?? null;
  const vault = vaults.find((v) => v.id === activeVaultId) ?? null;
  const standaloneTeam = !vault && activeVaultId
    ? (teams.find((t) => t.id === activeVaultId) ?? null)
    : null;
  const team = vault?.teamId
    ? (teams.find((t) => t.id === vault.teamId) ?? null)
    : standaloneTeam;
  const members = team ? (membersByTeam[team.id] ?? null) : null;
  const roles = team ? (rolesByTeam[team.id] ?? []) : [];

  // Load members if team is found but members aren't loaded yet
  useEffect(() => {
    if (team && !membersByTeam[team.id]) {
      loadMembers(team.id).catch(() => {});
    }
  }, [team?.id]);

  if (!vault && !standaloneTeam) return null;

  const displayName = vault ? vault.name : (standaloneTeam!.name);
  const initial = displayName.trim().charAt(0).toUpperCase();
  const isE2EE = accountMode === "local";
  const contentVaultId = team?.id ?? activeVaultId ?? "personal";
  const hostCount = connections.filter((c) => (c.vault_id ?? "personal") === contentVaultId).length;
  const keyCount = keys.filter((k) => (k.vault_id ?? "personal") === contentVaultId).length;
  const portRuleCount = portRules.filter((r) => (r.vault_id ?? "personal") === contentVaultId).length;
  const lastSync = relativeTime(syncState.lastSync);
  const showSync = syncState.cloudActive && lastSync;

  return (
    <div
      className="flex items-center shrink-0 px-4 gap-4 border-b rounded-tl-2xl"
      style={{
        height: "3.75rem",
        background: "var(--t-bg-toolbar)",
        borderColor: "var(--t-border)",
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
            {displayName}
          </span>
          {team && <Badge label="team" />}
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
          {portRuleCount > 0 && (
            <span>{portRuleCount} port rule{portRuleCount !== 1 ? "s" : ""}</span>
          )}
          {showSync && (
            <span>Last sync {lastSync}</span>
          )}
        </div>
      </div>

      {/* Online members */}
      {team && members !== null && (
        <OnlineMembersStack members={members} roles={roles} onInviteClick={openMembersInvite} />
      )}

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
