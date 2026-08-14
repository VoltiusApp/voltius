import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import type { ShareTier } from "@/services/teamSharing";

/** Seats-used/cap line shared by `ActiveSharingView` and `InvitePeopleSection`. */
export function ParticipantsRatioNotice({
  count,
  guestCap,
  tier,
  onUpgrade,
}: {
  count: number;
  guestCap: number;
  tier: ShareTier;
  onUpgrade: () => void;
}) {
  const { t } = useTranslation();
  const atCap = count >= guestCap;
  return (
    <div className="flex items-center gap-2 mb-3 text-xs" style={{ color: atCap ? "#f59e0b" : "var(--t-text-secondary)" }}>
      <Icon icon="lucide:users" width={13} />
      <span>{t("terminal.share.participantsRatio", { count: guestCap, participantCount: count, guestCap })}</span>
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
