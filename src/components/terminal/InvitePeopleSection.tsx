import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useTeamStore } from "@/stores/teamStore";
import { allTeammates, memberHasAccess, type Teammate } from "@/services/teamSharing";
import { ParticipantsRatioNotice } from "./ParticipantsRatioNotice";

interface InvitePeopleSectionProps {
  session: { vaultIds: string[]; participantIds: string[]; invitedIds: string[] };
  guestCap: number;
  tier: "free" | "pro" | "teams" | "business";
  onUpgrade: () => void;
  onInvite: (member: Teammate) => Promise<void>;
}

type RowStatus = "inviting" | "invited";

export function InvitePeopleSection({ session, guestCap, tier, onUpgrade, onInvite }: InvitePeopleSectionProps) {
  const { t } = useTranslation();
  const teams = useTeamStore((s) => s.teams);
  const [teammates, setTeammates] = useState<Teammate[] | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
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

  // Committed seats = participants + standing invites, deduped, plus invites this
  // menu session just sent — the server hasn't round-tripped those into `session`
  // yet, so without this a Pro host at cap 1 could tap a second teammate right after
  // the first invite lands.
  const invitedThisSession = Object.entries(rowStatus).filter(([, s]) => s === "invited").map(([id]) => id);
  const committedSeats = new Set([...session.participantIds, ...session.invitedIds, ...invitedThisSession]).size;
  const atCap = committedSeats >= guestCap;

  const handleInvite = async (member: Teammate) => {
    setError(null);
    setRowStatus((prev) => ({ ...prev, [member.user_id]: "inviting" }));
    try {
      await onInvite(member);
      setRowStatus((prev) => ({ ...prev, [member.user_id]: "invited" }));
    } catch {
      setRowStatus((prev) => {
        const next = { ...prev };
        delete next[member.user_id];
        return next;
      });
      setError(t("terminal.share.inviteFailed", { name: member.display_name }));
    }
  };

  return (
    <div className="px-3 pb-3">
      <p className="text-xs font-semibold mb-2" style={{ color: "var(--t-text-primary)" }}>
        {t("terminal.share.invitePeople")}
      </p>

      <ParticipantsRatioNotice count={committedSeats} guestCap={guestCap} tier={tier} onUpgrade={onUpgrade} />

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
            const status = rowStatus[member.user_id];
            // A row this session just invited keeps showing "Invited", not the cap notice.
            const capBlocked = atCap && !hasAccess && status !== "invited";
            return (
              <button
                key={member.user_id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md text-left disabled:cursor-default transition-colors"
                style={{ color: "var(--t-text-primary)", background: "transparent" }}
                disabled={hasAccess || status === "inviting" || capBlocked}
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
                ) : status === "inviting" ? (
                  <Icon icon="lucide:loader-circle" width={12} className="animate-spin" style={{ color: "var(--t-text-dim)" }} />
                ) : status === "invited" ? (
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
