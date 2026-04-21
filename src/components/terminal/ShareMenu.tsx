import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";

const ROLES = ["owner", "manager", "editor", "member"] as const;

interface ShareMenuProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
  activeSessionId: string;
  connectionName: string;
  isLoggedIn: boolean;
  onSignIn: () => void;
}

export function ShareMenu({ anchorRef, open, onClose, activeSessionId, connectionName, isLoggedIn, onSignIn }: ShareMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const [tab, setTab] = useState<"team" | "invite">("team");
  const [sessionName, setSessionName] = useState(connectionName);
  const [selectedVaultIds, setSelectedVaultIds] = useState<Set<string>>(new Set());
  const [vaultRoles, setVaultRoles] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLinkToken, setInviteLinkToken] = useState<string | null>(null);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);

  const { teams, loadTeams, loadMembers, membersByTeam } = useTeamStore();
  const mpConnections = useTeamSessionStore((s) => s.connections);
  const startSharing = useTeamSessionStore((s) => s.startSharing);
  const startSharingInviteLink = useTeamSessionStore((s) => s.startSharingInviteLink);
  const stopSharing = useTeamSessionStore((s) => s.stopSharing);

  const activeMp = mpConnections[activeSessionId];
  const isSharing = !!activeMp && !activeMp.ended;

  // Position + load teams on open
  useEffect(() => {
    if (!open) return;
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left + rect.width / 2 - 140 });
    }
    loadTeams().catch(() => {});
    setSessionName(connectionName);
    setTab("team");
    setSelectedVaultIds(new Set());
    setVaultRoles({});
    setError(null);
    setInviteLinkToken(null);
    setInviteLinkCopied(false);
  }, [open]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        anchorRef.current && !anchorRef.current.contains(e.target as Node) &&
        menuRef.current && !menuRef.current.contains(e.target as Node)
      ) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggleVault = (id: string) => {
    setSelectedVaultIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); setVaultRoles((r) => { const n = { ...r }; delete n[id]; return n; }); }
      else next.add(id);
      return next;
    });
  };

  const toggleRole = (vaultId: string, role: string) => {
    setVaultRoles((prev) => {
      const roles = new Set(prev[vaultId] ?? []);
      if (roles.has(role)) roles.delete(role); else roles.add(role);
      return { ...prev, [vaultId]: roles };
    });
  };

  const handleShareWithVaults = async () => {
    if (selectedVaultIds.size === 0) return;
    setLoading(true);
    setError(null);
    try {
      const vaultIds = Array.from(selectedVaultIds);
      await Promise.all(vaultIds.map((id) => !membersByTeam[id] ? loadMembers(id) : Promise.resolve()));
      const state = useTeamStore.getState();
      const allMembers = vaultIds.flatMap((id) => state.membersByTeam[id] ?? []);
      const allowedRoles = Array.from(new Set(vaultIds.flatMap((id) => Array.from(vaultRoles[id] ?? []))));
      await startSharing(activeSessionId, vaultIds, allowedRoles, sessionName || connectionName, allMembers);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to share");
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateInviteLink = async () => {
    setLoading(true);
    setError(null);
    try {
      const { inviteToken } = await startSharingInviteLink(activeSessionId, sessionName || connectionName);
      setInviteLinkToken(inviteToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate link");
    } finally {
      setLoading(false);
    }
  };

  const handleCopyInviteLink = async () => {
    if (!inviteLinkToken) return;
    const sessionId = activeMp?.multiplayerSessionId ?? "";
    await navigator.clipboard.writeText(`${sessionId}:${inviteLinkToken}`);
    setInviteLinkCopied(true);
    setTimeout(() => setInviteLinkCopied(false), 2000);
  };

  const handleStopSharing = async () => {
    setLoading(true);
    try {
      await stopSharing(activeSessionId);
      onClose();
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      ref={menuRef}
      className="fixed z-[9999] rounded-xl"
      style={{
        top: pos.top,
        left: pos.left,
        width: 280,
        background: "var(--t-bg-card)",
        border: "1px solid var(--t-border)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.35)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {!isLoggedIn ? (
        /* ── Unauthenticated view ── */
        <div className="px-4 py-4 flex flex-col items-center text-center gap-3">
          <div className="flex items-center justify-center size-9 rounded-full" style={{ background: "color-mix(in srgb, var(--t-accent) 12%, transparent)" }}>
            <Icon icon="lucide:share-2" width={16} style={{ color: "var(--t-accent)" }} />
          </div>
          <div>
            <p className="text-xs font-semibold mb-1" style={{ color: "var(--t-text-primary)" }}>
              Sign in to share
            </p>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--t-text-secondary)" }}>
              Connect a server account to share your terminal with teammates.
            </p>
          </div>
          <button
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-opacity"
            style={{ background: "var(--t-accent)", color: "var(--t-accent-fg)", opacity: 1 }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            onClick={onSignIn}
          >
            <Icon icon="lucide:log-in" width={12} />
            Sign in / Sign up
          </button>
        </div>
      ) : isSharing ? (
        /* ── Active sharing view ── */
        <ActiveSharingView
          activeMp={activeMp}
          connectionName={connectionName}
          loading={loading}
          onStop={handleStopSharing}
        />
      ) : (
        /* ── Setup view ── */
        <>
          {/* Header */}
          <div className="px-3 pt-3 pb-2">
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--t-text-primary)" }}>
              Share terminal
            </p>
            <input
              className="w-full text-xs px-2.5 py-1.5 rounded-md outline-none"
              style={{
                background: "var(--t-bg-elevated)",
                border: "1px solid var(--t-border)",
                color: "var(--t-text-primary)",
              }}
              placeholder="Session name…"
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
            />
          </div>

          {/* Tabs */}
          <div className="flex px-3 gap-1 mb-2">
            {(["team", "invite"] as const).map((t) => (
              <button
                key={t}
                className="flex-1 py-1 rounded-md text-xs font-medium transition-colors"
                style={{
                  background: tab === t ? "var(--t-bg-elevated)" : "transparent",
                  color: tab === t ? "var(--t-text-primary)" : "var(--t-text-dim)",
                  border: tab === t ? "1px solid var(--t-border)" : "1px solid transparent",
                }}
                onClick={() => setTab(t)}
              >
                {t === "team" ? "Team" : "Invite Link"}
              </button>
            ))}
          </div>

          {error && (
            <div className="mx-3 mb-2 px-2 py-1.5 rounded text-[11px]" style={{ background: "color-mix(in srgb, var(--t-status-error) 12%, transparent)", color: "var(--t-status-error)", border: "1px solid color-mix(in srgb, var(--t-status-error) 25%, transparent)" }}>
              {error}
            </div>
          )}

          {/* Tab content */}
          {tab === "team" ? (
            <TeamTab
              teams={teams}
              selectedVaultIds={selectedVaultIds}
              vaultRoles={vaultRoles}
              loading={loading}
              onToggleVault={toggleVault}
              onToggleRole={toggleRole}
              onShare={handleShareWithVaults}
            />
          ) : (
            <InviteLinkTab
              loading={loading}
              inviteLinkToken={inviteLinkToken}
              inviteLinkCopied={inviteLinkCopied}
              onGenerate={handleGenerateInviteLink}
              onCopy={handleCopyInviteLink}
            />
          )}
        </>
      )}
    </div>,
    document.body,
  );
}

// ─── Active sharing view ──────────────────────────────────────────────────────

function ActiveSharingView({
  activeMp,
  connectionName,
  loading,
  onStop,
}: {
  activeMp: NonNullable<ReturnType<typeof useTeamSessionStore.getState>["connections"][string]>;
  connectionName: string;
  loading: boolean;
  onStop: () => void;
}) {
  const participantCount = activeMp.participants.length;

  return (
    <div className="p-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: "var(--t-accent)" }} />
        <span className="text-xs font-semibold flex-1 truncate" style={{ color: "var(--t-text-primary)" }}>
          {connectionName}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "color-mix(in srgb, var(--t-accent) 15%, transparent)", color: "var(--t-accent)" }}>
          Live
        </span>
      </div>

      <div className="flex items-center gap-2 mb-3 text-xs" style={{ color: "var(--t-text-secondary)" }}>
        <Icon icon="lucide:users" width={13} />
        <span>{participantCount} participant{participantCount !== 1 ? "s" : ""}</span>
      </div>

      {activeMp.participants.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {activeMp.participants.map((p) => (
            <div
              key={p.user_id}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px]"
              style={{
                background: p.user_id === activeMp.controlHolder
                  ? "color-mix(in srgb, var(--t-accent) 15%, transparent)"
                  : "var(--t-bg-elevated)",
                color: p.user_id === activeMp.controlHolder ? "var(--t-accent)" : "var(--t-text-secondary)",
                border: "1px solid var(--t-border)",
              }}
              title={p.user_id === activeMp.controlHolder ? "Has control" : undefined}
            >
              {p.user_id === activeMp.controlHolder && <Icon icon="lucide:pencil" width={9} />}
              {p.display_name}
            </div>
          ))}
        </div>
      )}

      <button
        className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
        style={{
          background: "color-mix(in srgb, var(--t-status-error) 12%, transparent)",
          color: "var(--t-status-error)",
          border: "1px solid color-mix(in srgb, var(--t-status-error) 25%, transparent)",
        }}
        disabled={loading}
        onClick={onStop}
      >
        {loading
          ? <Icon icon="lucide:loader-2" width={12} className="animate-spin" />
          : <Icon icon="lucide:stop-circle" width={12} />}
        Stop sharing
      </button>
    </div>
  );
}

// ─── Team tab ─────────────────────────────────────────────────────────────────

function TeamTab({
  teams,
  selectedVaultIds,
  vaultRoles,
  loading,
  onToggleVault,
  onToggleRole,
  onShare,
}: {
  teams: { id: string; name: string }[];
  selectedVaultIds: Set<string>;
  vaultRoles: Record<string, Set<string>>;
  loading: boolean;
  onToggleVault: (id: string) => void;
  onToggleRole: (vaultId: string, role: string) => void;
  onShare: () => void;
}) {
  return (
    <div>
      <div className="max-h-48 overflow-y-auto px-2 pb-1">
        {teams.length === 0 ? (
          <p className="text-xs px-2 py-3 text-center" style={{ color: "var(--t-text-dim)" }}>
            No vaults — create a team first
          </p>
        ) : (
          teams.map((team) => {
            const selected = selectedVaultIds.has(team.id);
            const activeRoles = vaultRoles[team.id] ?? new Set();
            return (
              <div key={team.id} className="mb-1">
                {/* Vault row */}
                <div
                  className="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer"
                  style={{ color: "var(--t-text-primary)" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "var(--t-bg-elevated)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "transparent")}
                  onClick={() => onToggleVault(team.id)}
                >
                  <div
                    className="w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0"
                    style={{
                      background: selected ? "var(--t-accent)" : "transparent",
                      borderColor: selected ? "var(--t-accent)" : "var(--t-border)",
                    }}
                  >
                    {selected && <Icon icon="lucide:check" width={9} style={{ color: "white" }} />}
                  </div>
                  <Icon icon="lucide:vault" width={13} style={{ color: selected ? "var(--t-accent)" : "var(--t-text-secondary)" }} />
                  <span className="text-xs flex-1 truncate">{team.name}</span>
                </div>
                {/* Role chips — shown when vault is selected */}
                {selected && (
                  <div className="flex flex-wrap gap-1 pl-8 pr-2 pb-1.5">
                    {ROLES.map((role) => {
                      const active = activeRoles.has(role);
                      return (
                        <button
                          key={role}
                          className="text-[10px] px-1.5 py-0.5 rounded-full capitalize transition-colors"
                          style={{
                            background: active
                              ? "color-mix(in srgb, var(--t-accent) 18%, transparent)"
                              : "var(--t-bg-card)",
                            color: active ? "var(--t-accent)" : "var(--t-text-dim)",
                            border: `1px solid ${active ? "color-mix(in srgb, var(--t-accent) 35%, transparent)" : "var(--t-border)"}`,
                          }}
                          onClick={(e) => { e.stopPropagation(); onToggleRole(team.id, role); }}
                        >
                          {role}
                        </button>
                      );
                    })}
                    <span className="text-[10px] self-center" style={{ color: "var(--t-text-dim)" }}>
                      {activeRoles.size === 0 ? "all roles" : ""}
                    </span>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="px-3 pb-3 pt-1" style={{ borderTop: "1px solid var(--t-border)" }}>
        <button
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium mt-2 transition-opacity"
          style={{
            background: "var(--t-accent)",
            color: "white",
            opacity: selectedVaultIds.size === 0 || loading ? 0.45 : 1,
            cursor: selectedVaultIds.size === 0 ? "not-allowed" : "pointer",
          }}
          disabled={selectedVaultIds.size === 0 || loading}
          onClick={onShare}
        >
          {loading
            ? <Icon icon="lucide:loader-2" width={12} className="animate-spin" />
            : <Icon icon="lucide:radio" width={12} />}
          {selectedVaultIds.size > 0
            ? `Start sharing with ${selectedVaultIds.size} vault${selectedVaultIds.size > 1 ? "s" : ""}`
            : "Select a vault to share"}
        </button>
      </div>
    </div>
  );
}

// ─── Invite link tab ──────────────────────────────────────────────────────────

function InviteLinkTab({
  loading,
  inviteLinkToken,
  inviteLinkCopied,
  onGenerate,
  onCopy,
}: {
  loading: boolean;
  inviteLinkToken: string | null;
  inviteLinkCopied: boolean;
  onGenerate: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="px-3 pb-3">
      {inviteLinkToken ? (
        <>
          <p className="text-[11px] mb-2" style={{ color: "var(--t-text-secondary)" }}>
            Share this code — anyone with it can join:
          </p>
          <div className="flex items-center gap-2">
            <input
              readOnly
              className="flex-1 text-[11px] px-2.5 py-1.5 rounded-md outline-none font-mono"
              style={{
                background: "var(--t-bg-elevated)",
                border: "1px solid var(--t-border)",
                color: "var(--t-text-primary)",
              }}
              value={inviteLinkToken}
              onFocus={(e) => e.target.select()}
            />
            <button
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs shrink-0 transition-colors"
              style={{
                background: inviteLinkCopied
                  ? "color-mix(in srgb, var(--t-accent) 15%, transparent)"
                  : "var(--t-bg-elevated)",
                color: inviteLinkCopied ? "var(--t-accent)" : "var(--t-text-secondary)",
                border: "1px solid var(--t-border)",
              }}
              onClick={onCopy}
            >
              <Icon icon={inviteLinkCopied ? "lucide:check" : "lucide:copy"} width={12} />
              {inviteLinkCopied ? "Copied" : "Copy"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-[11px] mb-2" style={{ color: "var(--t-text-secondary)" }}>
            Generate a one-time link. Anyone with a Voltius account can join.
          </p>
          <button
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-opacity"
            style={{
              background: "var(--t-accent)",
              color: "white",
              opacity: loading ? 0.5 : 1,
            }}
            disabled={loading}
            onClick={onGenerate}
          >
            {loading
              ? <Icon icon="lucide:loader-2" width={12} className="animate-spin" />
              : <Icon icon="lucide:link" width={12} />}
            Generate invite link
          </button>
        </>
      )}
    </div>
  );
}
