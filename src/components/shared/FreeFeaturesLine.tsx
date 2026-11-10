import { useTranslation } from "react-i18next";
import { freeForEveryone, planFeatureLabel } from "@/services/planFeatures";
import { usePlatform } from "@/utils/platform";

export function FreeFeaturesLine({ className = "" }: { className?: string }) {
  const { t } = useTranslation();
  const labels = freeForEveryone(usePlatform()).map((f) => planFeatureLabel(t, f));
  return (
    <p data-free-features className={`text-xs text-(--t-text-muted) leading-relaxed ${className}`}>
      <span className="font-medium text-(--t-text-secondary)">{t("settings.account.plan.freeForEveryone")}</span>{" "}
      {labels.join(" · ")}
    </p>
  );
}
