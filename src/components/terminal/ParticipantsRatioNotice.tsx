import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import type { ShareTier } from "@/services/teamSharing";

/**
 * Guests-against-cap line. `atCap` is passed in rather than re-derived from `count`, so
 * this can never disagree with the guard that disables the rows beside it.
 * `countsInvites` picks the honest wording: at the invite roster `count` includes
 * pending invites, elsewhere it is live participants only.
 *
 * The wording deliberately says "guests", never "seats" — `members.seatsSummary`
 * and `buySeats` mean BILLING seats, and a terminal invite costs none.
 */
export function ParticipantsRatioNotice({
  count,
  guestCap,
  atCap,
  countsInvites,
  tier,
  onUpgrade,
}: {
  count: number;
  guestCap: number;
  atCap: boolean;
  countsInvites?: boolean;
  tier: ShareTier;
  onUpgrade: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 mb-3 text-xs" style={{ color: atCap ? "#f59e0b" : "var(--t-text-secondary)" }}>
      <Icon icon="lucide:users" width={13} />
      <span>
        {t(countsInvites ? "terminal.share.guestsRatio" : "terminal.share.participantsRatio", {
          count: guestCap,
          participantCount: count,
          guestCap,
        })}
      </span>
      {atCap && tier !== "business" && (
        <button
          className="text-[10px] underline ml-auto"
          style={{ background: "none", border: "none", cursor: "pointer", color: "#f59e0b" }}
          onClick={onUpgrade}
        >
          {tier === "pro" ? t("terminal.share.upgradeToTeams") : t("terminal.share.upgradeToBusiness")}
        </button>
      )}
    </div>
  );
}
