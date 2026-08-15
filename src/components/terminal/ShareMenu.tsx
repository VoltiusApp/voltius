import { writeClipboard } from "../../utils/clipboard";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { buildInviteCode } from "@/services/inviteCode";
import { guestCapFor, highestOwnerTier, inviteSessionOf, membersOfTeams, seatUsage, type InviteSession, type InviteTarget, type ShareTier } from "@/services/teamSharing";
import { useDelayedUnmount } from "@/hooks/useDelayedUnmount";
import { InviteCodeField } from "./InviteCodeField";
import { PeopleTab } from "./PeopleTab";
import { ParticipantsRatioNotice } from "./ParticipantsRatioNotice";

const EXIT_MS = 140;

const ROLES = ["owner", "manager", "editor", "member"] as const;

interface ShareMenuProps {
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  open: boolean;
  onClose: () => void;
  activeSessionId: string;
  connectionName: string;
  connectionVaultId?: string;
  isLoggedIn: boolean;
  tier: ShareTier;
  onSignIn: () => void;
  onUpgrade: () => void;
}

export function ShareMenu({ anchorRef, open, onClose, activeSessionId, connectionName, connectionVaultId, isLoggedIn, tier, onSignIn, onUpgrade }: ShareMenuProps) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const mounted = useDelayedUnmount(open, EXIT_MS);
  const [pos, setPos] = useState({ top: 0, left: 0, originX: 140 });
  const [tab, setTab] = useState<"people" | "invite" | "team">("people");
  const [sessionName, setSessionName] = useState(connectionName);
  const [selectedVaultIds, setSelectedVaultIds] = useState<Set<string>>(new Set());
  const [vaultRoles, setVaultRoles] = useState<Record<string, Set<string>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteLinkToken, setInviteLinkToken] = useState<string | null>(null);
  const [autoCopied, setAutoCopied] = useState(false);
  // Held here rather than in PeopleTab: the first direct invite creates the
  // session, which swaps the setup view for the active view and remounts the tab.
  const [invitedThisSession, setInvitedThisSession] = useState<ReadonlySet<string>>(new Set());

  const { teams, loading: teamsLoading, loadTeams } = useTeamStore();
  const mpConnections = useTeamSessionStore((s) => s.connections);
  const activeSessions = useTeamSessionStore((s) => s.activeSessions);
  const startSharing = useTeamSessionStore((s) => s.startSharing);
  const startSharingInviteLink = useTeamSessionStore((s) => s.startSharingInviteLink);
  const startSharingDirect = useTeamSessionStore((s) => s.startSharingDirect);
  const inviteToActiveSession = useTeamSessionStore((s) => s.inviteToActiveSession);
  const stopSharing = useTeamSessionStore((s) => s.stopSharing);

  const activeMp = mpConnections[activeSessionId];
  const isSharing = !!activeMp && !activeMp.ended;

  // The server's record of this session, if one exists yet — the source of truth for
  // vault scope and per-invitee grants (#66). Empty until this local session has a
  // multiplayer counterpart the server has told us about.
  const matchingActiveSession = activeSessions.find((s) => s.id === activeMp?.multiplayerSessionId);
  const inviteSession = inviteSessionOf(activeMp, matchingActiveSession);

  // Vaults whose owner has a qualifying plan (teams/business) — free-tier users can share to these
  const qualifyingVaults = teams.filter((t) => t.owner_tier === "teams" || t.owner_tier === "business");
  const hasQualifyingVaults = qualifyingVaults.length > 0;

  // For free/pro users, team sharing is only allowed when the connection itself lives in a qualifying vault.
  // This prevents piggybacking on a team owner's plan for personal connections.
  const connectionInQualifyingVault =
    !!connectionVaultId &&
    connectionVaultId !== "personal" &&
    qualifyingVaults.some((v) => v.id === connectionVaultId);

  // Effective cap for the active session: use vault owner's tier when available
  const guestCap = guestCapFor(activeMp?.vaultOwnerTier ?? tier);

  // Tab availability — People and Link both need Pro+ (host_tier_session_limit
  // rejects free with 402, so gate here rather than round-trip a raw error).
  // Team vault: for Pro it also needs the connection in a qualifying vault (the
  // anti-piggyback rule above); for free/teams/business it's ungated here — free
  // is gated by the outer upgrade wall instead, teams/business own their vaults
  // outright. People leads whenever it's available: it fits "invite a specific
  // person" best.
  const teamTabAvailable = tier === "pro" ? connectionInQualifyingVault : true;
  const availableTabs: readonly ("people" | "invite" | "team")[] = [
    ...(tier !== "free" ? (["people", "invite"] as const) : []),
    ...(teamTabAvailable ? (["team"] as const) : []),
  ];

  // Position + load teams on open
  useEffect(() => {
    if (!open) return;
    if (anchorRef.current) {
      const rect = anchorRef.current.getBoundingClientRect();
      const left = rect.left + rect.width / 2 - 140;
      setPos({ top: rect.bottom + 4, left, originX: rect.left + rect.width / 2 - left });
    }
    loadTeams().catch(() => {});
    setSessionName(connectionName);
    setTab(availableTabs[0]);
    setSelectedVaultIds(connectionVaultId && connectionVaultId !== "personal" ? new Set([connectionVaultId]) : new Set());
    setVaultRoles({});
    setError(null);
    setInvitedThisSession(new Set());
    if (!isSharing) {
      setInviteLinkToken(null);
      setAutoCopied(false);
    }
  }, [open]);

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
      const allMembers = await membersOfTeams(vaultIds);
      const allowedRoles = Array.from(new Set(vaultIds.flatMap((id) => Array.from(vaultRoles[id] ?? []))));
      await startSharing(
        activeSessionId, vaultIds, allowedRoles, sessionName || connectionName,
        allMembers, highestOwnerTier(vaultIds),
      );
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg.includes("429") || msg.includes("Too Many")
          ? t("terminal.share.sessionLimitReached")
          : msg || t("terminal.share.failedToShare"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateInviteLink = async () => {
    setLoading(true);
    setError(null);
    try {
      const { multiplayerSessionId, inviteToken } = await startSharingInviteLink(activeSessionId, sessionName || connectionName);
      setInviteLinkToken(inviteToken);
      try {
        await writeClipboard(buildInviteCode(multiplayerSessionId, inviteToken));
        setAutoCopied(true);
      } catch {
        setAutoCopied(false);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(
        msg.includes("429") || msg.includes("Too Many")
          ? t("terminal.share.sessionLimitReached")
          : msg || t("terminal.share.failedToGenerateLink"),
      );
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (target: InviteTarget) => {
    if (isSharing) await inviteToActiveSession(activeSessionId, target);
    else await startSharingDirect(activeSessionId, sessionName || connectionName, [target]);
    setInvitedThisSession((prev) => new Set(prev).add(target.user_id));
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

  if (!mounted) return null;

  return createPortal(
    <div
      ref={menuRef}
      className={`surface-float fixed z-9999 ${open ? "animate-fadeIn [animation-duration:140ms]" : "animate-fadeOut [animation-duration:110ms]"}`}
      style={{
        top: pos.top,
        left: pos.left,
        width: 280,
        transformOrigin: `${pos.originX}px top`,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {!isLoggedIn ? (
        /* ── Unauthenticated view ── */
        <div className="px-4 py-4 flex flex-col items-center text-center gap-3">
          <div className="flex items-center justify-center size-9 rounded-full" style={{ background: "color-mix(in srgb, var(--t-accent) 12%, transparent)" }}>
            <Icon icon="lucide:radio" width={16} style={{ color: "var(--t-accent)" }} />
          </div>
          <div>
            <p className="text-xs font-semibold mb-1" style={{ color: "var(--t-text-primary)" }}>
              {t("terminal.share.signInToShare")}
            </p>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--t-text-secondary)" }}>
              {t("terminal.share.signInDescription")}
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
            {t("terminal.share.signInButton")}
          </button>
        </div>
      ) : tier === "free" && teamsLoading ? (
        /* ── Loading — defer upgrade wall decision until teams are known ── */
        <div className="px-4 py-6 flex items-center justify-center">
          <Icon icon="lucide:loader-circle" width={16} className="animate-spin" style={{ color: "var(--t-text-dim)" }} />
        </div>
      ) : tier === "free" && (!hasQualifyingVaults || !connectionInQualifyingVault) ? (
        /* ── Free-tier upgrade wall — no qualifying team vaults ── */
        <div className="px-4 py-4 flex flex-col items-center text-center gap-3">
          <div
            className="flex items-center justify-center size-9 rounded-full"
            style={{ background: "color-mix(in srgb, var(--t-accent) 12%, transparent)" }}
          >
            <Icon icon="lucide:lock" width={16} style={{ color: "var(--t-accent)" }} />
          </div>
          <div>
            <p className="text-xs font-semibold mb-1" style={{ color: "var(--t-text-primary)" }}>
              {t("terminal.share.proRequired")}
            </p>
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--t-text-secondary)" }}>
              {t("terminal.share.proRequiredDescription")}
            </p>
          </div>
          <div className="w-full flex flex-col gap-1 text-left">
            {(t("terminal.share.features", { returnObjects: true }) as string[]).map((feat) => (
              <div key={feat} className="flex items-start gap-2 text-[11px]" style={{ color: "var(--t-text-secondary)" }}>
                <Icon icon="lucide:check" width={11} className="mt-0.5 shrink-0" style={{ color: "var(--t-accent)" }} />
                <span>{feat}</span>
              </div>
            ))}
          </div>
          <button
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-opacity"
            style={{ background: "var(--t-accent)", color: "var(--t-accent-fg)", opacity: 1 }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
            onClick={onUpgrade}
          >
            {t("terminal.share.upgradeToPro")}
          </button>
        </div>
      ) : isSharing ? (
        /* ── Active sharing view ── */
        <ActiveSharingView
          activeMp={activeMp}
          connectionName={connectionName}
          loading={loading}
          guestCap={guestCap}
          inviteLinkToken={inviteLinkToken}
          autoCopied={autoCopied}
          tier={tier}
          inviteSession={inviteSession}
          invitedThisSession={invitedThisSession}
          onInvite={handleInvite}
          onStop={handleStopSharing}
          onUpgrade={onUpgrade}
        />
      ) : (
        /* ── Setup view ── */
        <>
          {/* Header */}
          <div className="px-3 pt-3 pb-2">
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--t-text-primary)" }}>
              {t("terminal.share.shareTerminal")}
            </p>
            <input
              className="w-full text-xs px-2.5 py-1.5 rounded-md outline-hidden"
              style={{
                background: "var(--t-bg-elevated)",
                border: "1px solid var(--t-border)",
                color: "var(--t-text-primary)",
              }}
              placeholder={t("terminal.share.sessionNamePlaceholder")}
              value={sessionName}
              onChange={(e) => setSessionName(e.target.value)}
            />
          </div>

          {/* Tabs — omitted entirely when only one is available (e.g. a Pro host
              whose connection isn't in a qualifying vault sees no Team tab). */}
          {availableTabs.length > 1 && (
            <div className="flex px-3 gap-1 mb-2">
              {availableTabs.map((tabId) => (
                <button
                  key={tabId}
                  className="flex-1 py-1 rounded-md text-xs font-medium transition-colors"
                  style={{
                    background: tab === tabId ? "var(--t-bg-elevated)" : "transparent",
                    color: tab === tabId ? "var(--t-text-primary)" : "var(--t-text-dim)",
                    border: tab === tabId ? "1px solid var(--t-border)" : "1px solid transparent",
                  }}
                  onClick={() => setTab(tabId)}
                >
                  {tabId === "people" ? t("terminal.share.tabPeople") : tabId === "team" ? t("terminal.share.tabTeam") : t("terminal.share.tabInviteLink")}
                </button>
              ))}
            </div>
          )}

          {error && (
            <div className="mx-3 mb-2 px-2 py-1.5 rounded-sm text-[11px]" style={{ background: "color-mix(in srgb, var(--t-status-error) 12%, transparent)", color: "var(--t-status-error)", border: "1px solid color-mix(in srgb, var(--t-status-error) 25%, transparent)" }}>
              {error}
            </div>
          )}

          {/* Tab content */}
          {tab === "people" ? (
            <PeopleTab
              session={inviteSession}
              invitedThisSession={invitedThisSession}
              guestCap={guestCap}
              tier={tier}
              onUpgrade={onUpgrade}
              onInvite={handleInvite}
            />
          ) : tab === "team" ? (
            <TeamTab
              teams={(tier === "free" || tier === "pro") ? qualifyingVaults : teams}
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
              sessionId={activeMp?.multiplayerSessionId ?? ""}
              autoCopied={autoCopied}
              guestCap={guestCap}
              tier={tier}
              onGenerate={handleGenerateInviteLink}
              onUpgrade={onUpgrade}
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
  guestCap,
  inviteLinkToken,
  autoCopied,
  tier,
  inviteSession,
  invitedThisSession,
  onInvite,
  onStop,
  onUpgrade,
}: {
  activeMp: NonNullable<ReturnType<typeof useTeamSessionStore.getState>["connections"][string]>;
  connectionName: string;
  loading: boolean;
  guestCap: number;
  inviteLinkToken: string | null;
  autoCopied: boolean;
  tier: ShareTier;
  inviteSession: InviteSession;
  invitedThisSession: ReadonlySet<string>;
  onInvite: (target: InviteTarget) => Promise<void>;
  onStop: () => void;
  onUpgrade: () => void;
}) {
  const { t } = useTranslation();
  const participantCount = inviteSession.participantIds.length;
  // An invite_link session retains no per-user session key (#66) — inviting into it
  // would always throw cannotInviteWithoutSessionKey, so don't offer the action.
  const canInviteDirectly = !!activeMp.sessionKeyBytes;
  const { committedSeats, atCap } = seatUsage(inviteSession, invitedThisSession, guestCap);

  return (
    <div className="p-3">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: "var(--t-accent)" }} />
        <span className="text-xs font-semibold flex-1 truncate" style={{ color: "var(--t-text-primary)" }}>
          {connectionName}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "color-mix(in srgb, var(--t-accent) 15%, transparent)", color: "var(--t-accent)" }}>
          {t("terminal.share.live")}
        </span>
      </div>

      {/* Exactly one seats line per view. The invite roster below draws its own, which
          also counts standing invites; a second one here would contradict it. This
          fallback covers the invite_link case, which has no roster — and no invitees
          either, so its seat count is just the live participants. */}
      {!canInviteDirectly && (
        <ParticipantsRatioNotice count={committedSeats} guestCap={guestCap} atCap={atCap} tier={tier} onUpgrade={onUpgrade} />
      )}

      {participantCount > 0 && (
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
              title={p.user_id === activeMp.controlHolder ? t("terminal.share.hasControl") : undefined}
            >
              {p.user_id === activeMp.controlHolder && <Icon icon="lucide:pencil" width={9} />}
              {p.display_name}
            </div>
          ))}
        </div>
      )}

      {participantCount === 0 && (
        <p className="text-[11px] mb-3" style={{ color: "var(--t-text-dim)" }}>
          {t("terminal.share.waitingForGuests")}
        </p>
      )}

      {inviteLinkToken && (
        <div className="mb-3">
          <InviteCodeField code={buildInviteCode(activeMp.multiplayerSessionId, inviteLinkToken)} autoCopied={autoCopied} />
        </div>
      )}

      {canInviteDirectly && (
        <PeopleTab
          session={inviteSession}
          invitedThisSession={invitedThisSession}
          guestCap={guestCap}
          tier={tier}
          onUpgrade={onUpgrade}
          onInvite={onInvite}
        />
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
          ? <Icon icon="lucide:loader-circle" width={12} className="animate-spin" />
          : <Icon icon="lucide:circle-stop" width={12} />}
        {t("terminal.share.stopSharing")}
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
  const { t } = useTranslation();
  return (
    <div>
      <div className="max-h-48 overflow-y-auto px-2 pb-1">
        {teams.length === 0 ? (
          <p className="text-xs px-2 py-3 text-center" style={{ color: "var(--t-text-dim)" }}>
            {t("terminal.share.noVaultsCreateTeamFirst")}
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
                    className="w-3.5 h-3.5 rounded-sm border flex items-center justify-center shrink-0"
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
                      {activeRoles.size === 0 ? t("terminal.share.allRoles") : ""}
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
            ? <Icon icon="lucide:loader-circle" width={12} className="animate-spin" />
            : <Icon icon="lucide:radio" width={12} />}
          {selectedVaultIds.size > 0
            ? t("terminal.share.startSharingWithVault", { count: selectedVaultIds.size })
            : t("terminal.share.selectVaultToShare")}
        </button>
      </div>
    </div>
  );
}

// ─── Invite link tab ──────────────────────────────────────────────────────────

function InviteLinkTab({
  loading,
  inviteLinkToken,
  sessionId,
  autoCopied,
  guestCap,
  tier,
  onGenerate,
  onUpgrade,
}: {
  loading: boolean;
  inviteLinkToken: string | null;
  sessionId: string;
  autoCopied: boolean;
  guestCap: number;
  tier: ShareTier;
  onGenerate: () => void;
  onUpgrade: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="px-3 pb-3">
      {inviteLinkToken ? (
        <>
          <p className="text-[11px] mb-2" style={{ color: "var(--t-text-secondary)" }}>
            {t("terminal.share.shareCodeDescription")}
          </p>
          <InviteCodeField code={buildInviteCode(sessionId, inviteLinkToken)} autoCopied={autoCopied} />
        </>
      ) : (
        <>
          <p className="text-[11px] mb-2" style={{ color: "var(--t-text-secondary)" }}>
            {t("terminal.share.generateLinkDescription")}
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
              ? <Icon icon="lucide:loader-circle" width={12} className="animate-spin" />
              : <Icon icon="lucide:link" width={12} />}
            {t("terminal.share.generateInviteLink")}
          </button>
          <p className="text-[10px] mt-1.5 text-center" style={{ color: "var(--t-text-dim)" }}>
            {t("terminal.share.upToParticipants", { count: guestCap })}
          </p>
          {tier === "pro" && (
            <button
              className="w-full text-[10px] mt-0.5 text-center underline"
              style={{ color: "var(--t-text-dim)", background: "none", border: "none", cursor: "pointer" }}
              onClick={onUpgrade}
            >
              {t("terminal.share.upgradeToTeamsForParticipants")}
            </button>
          )}
        </>
      )}
    </div>
  );
}
