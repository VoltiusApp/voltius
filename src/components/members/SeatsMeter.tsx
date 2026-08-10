import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useSubscriptionStore } from "@/stores/subscriptionStore";
import { seatAvailability } from "@/services/seatMath";

/** Seat usage bar for the invite surfaces, with an optional "buy seats" action. */
export function SeatsMeter({ onBuySeats }: { onBuySeats?: () => void }) {
  const { t } = useTranslation();
  const { usedSeats, totalSeats } = useSubscriptionStore();
  const { atLimit, available } = seatAvailability(usedSeats, totalSeats);

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="h-1.5 rounded-full overflow-hidden mb-1.5" style={{ background: "var(--t-bg-elevated)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{
              width: totalSeats ? `${Math.min(100, ((usedSeats ?? 0) / totalSeats) * 100)}%` : "0%",
              background: atLimit ? "var(--t-status-error)" : "var(--t-accent)",
            }}
          />
        </div>
        <p className="text-[11px] tabular-nums" style={{ color: atLimit ? "var(--t-status-error)" : "var(--t-text-dim)" }}>
          {t("members.invite.seatsSummary", {
            used: usedSeats ?? 0,
            available: available ?? "?",
            total: totalSeats ?? "?",
          })}
        </p>
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
