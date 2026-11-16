import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useSubjectLabel } from "@/components/preview/PreviewScope";

export function ViewAsBanner() {
  const { t } = useTranslation();
  const name = useSubjectLabel();
  return (
    <div
      data-testid="view-as-banner"
      className="shrink-0 flex items-center justify-center gap-2 px-3 py-1.5 text-xs border-b"
      style={{
        background: "color-mix(in srgb, var(--t-accent) 12%, transparent)",
        borderColor: "color-mix(in srgb, var(--t-accent) 30%, transparent)",
        color: "var(--t-text-primary)",
      }}
    >
      <Icon icon="lucide:scan-eye" width={14} style={{ color: "var(--t-accent)" }} />
      <span>{t("members.viewAs.viewingAsReadOnly", { name })}</span>
    </div>
  );
}
