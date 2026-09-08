import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { seatState } from "@/components/vault-share/vaultShareModel";
import { displaySeatCap } from "@/services/seatMath";

/** Seat usage bar for the invite surfaces, with an optional "buy seats" action. */
export function SeatsMeter({ onBuySeats }: { onBuySeats?: () => void }) {
  const { t } = useTranslation();
  const { usedSeats, effectiveSeats, totalSeats, isTrialActive } = useSubscriptionStore();
  // The enforced cap, so the meter and the server agree on when invites stop.
  const seats = seatState(usedSeats, displaySeatCap(effectiveSeats, totalSeats));
  // A trial clamps the cap below what was purchased; without this the meter is a
  // number nothing on screen explains.
  const trialClamped =
    isTrialActive && effectiveSeats != null && totalSeats != null && effectiveSeats < totalSeats;
  const atLimit = seats.kind === "known" && seats.atLimit;
  const barWidth = seats.kind === "known" && seats.total > 0
    ? `${Math.min(100, (seats.used / seats.total) * 100)}%`
    : "0%";

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: "var(--t-bg-elevated)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: barWidth, background: atLimit ? "var(--t-status-error)" : "var(--t-accent)" }}
          />
        </div>
        {seats.kind === "unknown" ? (
          <p className="text-[11px]" style={{ color: "var(--t-text-dim)" }}>{t("members.invite.seatsUnknown")}</p>
        ) : (
          <>
            <p className="text-[11px] tabular-nums" style={{ color: atLimit ? "var(--t-status-error)" : "var(--t-text-dim)" }}>
              {t("members.invite.seatsSummary", { used: seats.used, available: seats.available, total: seats.total })}
            </p>
            <p className="text-[11px] mt-0.5" style={{ color: "var(--t-text-dim)" }}>
              {trialClamped
                ? t("members.invite.seatsTrialClamp", { cap: seats.total, purchased: totalSeats })
                : t("members.invite.seatsScope")}
            </p>
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
