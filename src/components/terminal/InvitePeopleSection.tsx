import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useTeamStore } from "@/stores/teamStore";
import { allTeammates, memberHasAccess, seatUsage, type InviteSession, type ShareTier, type Teammate } from "@/services/teamSharing";
import { ParticipantsRatioNotice } from "./ParticipantsRatioNotice";

interface InvitePeopleSectionProps {
  session: InviteSession;
  /**
   * Members invited during this menu session. Owned by ShareMenu, not here: the
   * first invite on an unshared terminal creates the session, which flips the menu
   * from the setup view to the active view and remounts this component. Local state
   * would be lost exactly when the cap most needs it, since the server's
   * `invitee_ids` round-trip has not landed yet either.
   */
  invitedThisSession: ReadonlySet<string>;
  guestCap: number;
  tier: ShareTier;
  onUpgrade: () => void;
  onInvite: (member: Teammate) => Promise<void>;
}

export function InvitePeopleSection({ session, invitedThisSession, guestCap, tier, onUpgrade, onInvite }: InvitePeopleSectionProps) {
  const { t } = useTranslation();
  const teams = useTeamStore((s) => s.teams);
  const [teammates, setTeammates] = useState<Teammate[] | null>(null);
  const [inviting, setInviting] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // Reload whenever the team list changes — ShareMenu kicks off `loadTeams()`
  // fire-and-forget on open, so on a fresh install/first sign-in the roster
  // this depends on isn't populated yet when this component first mounts.
  useEffect(() => {
    let cancelled = false;
    allTeammates()
      .then((m) => {
        if (cancelled) return;
        setTeammates(m);
        setLoadFailed(false);
      })
      .catch(() => {
        if (cancelled) return;
        setTeammates([]);
        setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [teams]);

  // Render nothing until the roster has loaded, so the section never flashes an empty header.
  if (teammates === null) return null;

  const { committedSeats, atCap } = seatUsage(session, invitedThisSession, guestCap);

  const setInFlight = (userId: string, active: boolean) =>
    setInviting((prev) => {
      const next = new Set(prev);
      if (active) next.add(userId); else next.delete(userId);
      return next;
    });

  const handleInvite = async (member: Teammate) => {
    setError(null);
    setInFlight(member.user_id, true);
    try {
      await onInvite(member);
    } catch {
      setError(t("terminal.share.inviteFailed", { name: member.display_name }));
    } finally {
      setInFlight(member.user_id, false);
    }
  };

  return (
    <div className="px-3 pb-3">
      <p className="text-xs font-semibold mb-2" style={{ color: "var(--t-text-primary)" }}>
        {t("terminal.share.invitePeople")}
      </p>

      <ParticipantsRatioNotice count={committedSeats} guestCap={guestCap} atCap={atCap} countsInvites tier={tier} onUpgrade={onUpgrade} />

      {error && (
        <div
          className="mb-2 px-2 py-1.5 rounded-sm text-[11px]"
          style={{
            background: "color-mix(in srgb, var(--t-status-error) 12%, transparent)",
            color: "var(--t-status-error)",
            border: "1px solid color-mix(in srgb, var(--t-status-error) 25%, transparent)",
          }}
        >
          {error}
        </div>
      )}

      {loadFailed ? (
        <p className="text-xs text-center py-2" style={{ color: "var(--t-status-error)" }}>
          {t("terminal.share.inviteLoadFailed")}
        </p>
      ) : teammates.length === 0 ? (
        <p className="text-xs text-center py-2" style={{ color: "var(--t-text-dim)" }}>
          {t("terminal.share.inviteNoTeammates")}
        </p>
      ) : (
        <div className="flex flex-col gap-0.5">
          {teammates.map((member) => {
            const hasAccess = memberHasAccess(member, session);
            const inFlight = inviting.has(member.user_id);
            const invited = invitedThisSession.has(member.user_id);
            // A row this session just invited keeps showing "Invited", not the cap notice.
            const capBlocked = atCap && !hasAccess && !invited;
            return (
              <button
                key={member.user_id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md text-left disabled:cursor-default transition-colors"
                style={{ color: "var(--t-text-primary)", background: "transparent" }}
                disabled={hasAccess || inFlight || invited || capBlocked}
                onClick={() => handleInvite(member)}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: member.is_online ? "var(--t-status-success)" : "var(--t-text-dim)" }}
                />
                <span className="text-xs flex-1 truncate">{member.display_name}</span>
                {hasAccess ? (
                  <span className="text-[10px]" style={{ color: "var(--t-text-dim)" }}>
                    {t("terminal.share.inviteHasAccess")}
                  </span>
                ) : inFlight ? (
                  <Icon icon="lucide:loader-circle" width={12} className="animate-spin" style={{ color: "var(--t-text-dim)" }} />
                ) : invited ? (
                  <span className="text-[10px]" style={{ color: "var(--t-accent)" }}>
                    {t("terminal.share.inviteSent")}
                  </span>
                ) : capBlocked ? (
                  <span className="text-[10px]" style={{ color: "var(--t-text-dim)" }}>
                    {t("terminal.share.inviteCapReached")}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
