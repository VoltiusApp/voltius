import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { useTeamStore } from "@/stores/teamStore";
import { useMyUserId } from "@/hooks/useMyUserId";
import { useTeamSeatReadout } from "@/hooks/useTeamSeatReadout";
import { seatsSummaryText } from "@/services/seatMath";

/** Seat usage bar for the invite surfaces, with a "buy seats" action on servers that sell them.
 *  With a `teamId`, it shows the seats of that team's owner when the server reports them. */
export function SeatsMeter({ teamId, onBuySeats }: { teamId?: string; onBuySeats?: () => void }) {
  const { t } = useTranslation();
  const { effectiveSeats, totalSeats, isTrialActive } = useSubscriptionStore();
  const { seats, fromTeam } = useTeamSeatReadout(teamId);
  const myUserId = useMyUserId();
  const ownerId = useTeamStore((s) => (teamId ? s.teams.find((tm) => tm.id === teamId)?.owner_id : undefined));
  // The trial clamp and the "every team you own" scope describe the viewer's own plan.
  const ownPlan = !fromTeam || (!!myUserId && ownerId === myUserId);
  // A trial clamps the cap below what was purchased; without this the meter is a
  // number nothing on screen explains.
  const trialClamped =
    ownPlan && isTrialActive && effectiveSeats != null && totalSeats != null && effectiveSeats < totalSeats;
  const atLimit = seats.kind === "known" && seats.atLimit;
  const barWidth = seats.kind === "known" && seats.total > 0
    ? `${Math.min(100, (seats.used / seats.total) * 100)}%`
    : "0%";
  const note = trialClamped && seats.kind === "known"
    ? t("members.invite.seatsTrialClamp", { cap: seats.total, purchased: totalSeats })
    : ownPlan ? t("members.invite.seatsScope") : null;

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        {seats.kind !== "unlimited" && (
          <div className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: "var(--t-bg-elevated)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{ width: barWidth, background: atLimit ? "var(--t-status-error)" : "var(--t-accent)" }}
            />
          </div>
        )}
        {seats.kind === "unknown" ? (
          <p className="text-[11px]" style={{ color: "var(--t-text-dim)" }}>{seatsSummaryText(t, seats)}</p>
        ) : (
          <>
            <p className="text-[11px] tabular-nums" style={{ color: atLimit ? "var(--t-status-error)" : "var(--t-text-dim)" }}>
              {seatsSummaryText(t, seats)}
            </p>
            {note && (
              <p className="text-[11px] mt-0.5" style={{ color: "var(--t-text-dim)" }}>{note}</p>
            )}
          </>
        )}
      </div>
      {onBuySeats && (
        <button
          onClick={onBuySeats}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{ background: "var(--t-bg-elevated)", color: "var(--t-accent)", border: "1px solid var(--t-border)" }}
        >
          <Icon icon="lucide:plus" width={11} />
          {t("members.invite.buySeats")}
        </button>
      )}
    </div>
  );
}
