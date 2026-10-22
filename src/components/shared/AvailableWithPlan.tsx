import { useTranslation } from "react-i18next";

/** Stands in for a purchase button in builds that may not link to checkout. */
export function AvailableWithPlan({ plan, className = "" }: { plan: "Pro" | "Teams" | "Business"; className?: string }) {
  const { t } = useTranslation();
  return <p className={`text-xs text-center text-(--t-text-dim) ${className}`}>{t("shared.availableWith", { plan })}</p>;
}
