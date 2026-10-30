import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

export function PaneDropOverlay() {
  const { t } = useTranslation();
  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center rounded-sm pointer-events-none"
      style={{ background: "color-mix(in srgb, var(--t-accent) 12%, transparent)", border: "2px solid var(--t-accent)" }}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-(--t-bg-card) border border-(--t-accent)">
        <Icon icon="lucide:arrow-down-to-line" width={14} className="text-(--t-accent)" />
        <span className="text-xs font-medium text-(--t-accent)">{t("fileTransfer.pane.dropToTransfer")}</span>
      </div>
    </div>
  );
}
