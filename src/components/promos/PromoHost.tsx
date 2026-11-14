import { usePromoStore } from "@/stores/promoStore";
import { ProRedeemModal } from "./ProRedeemModal";
import { TeamsPromoModal } from "./TeamsPromoModal";
import { PlanEndedModal } from "./PlanEndedModal";

/** Renders whichever promo `promoStore.current` names; closing goes back through the store. */
export function PromoHost() {
  const current = usePromoStore((s) => s.current);
  const close = usePromoStore((s) => s.close);
  if (!current) return null;

  const { promo, source, context, occurrence } = current;
  // Keyed so a promo replacing another starts from fresh local state.
  const key = `${promo}:${source}:${occurrence ?? ""}`;
  switch (promo) {
    case "pro_redeem":
      return <ProRedeemModal key={key} source={source} context={context} onClose={close} />;
    case "teams_promo":
      return <TeamsPromoModal key={key} source={source} context={context} onClose={close} />;
    case "plan_ended":
      return <PlanEndedModal key={key} source={source} occurrence={occurrence} onClose={close} />;
  }
}
