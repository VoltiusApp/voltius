import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { usePreviewStore } from "@/stores/previewStore";
import { useSubjectLabel } from "@/components/preview/PreviewScope";
import { PreviewStatus } from "@/components/preview/PreviewStatus";
import { ViewAsExitConfirm } from "@/components/preview/ViewAsExitConfirm";
import { useViewAsExit } from "@/components/preview/useViewAsExit";

export default function MobileViewAsBar() {
  const { t } = useTranslation();
  const previewing = usePreviewStore((s) => s.session !== null);
  const name = useSubjectLabel();
  const exitFlow = useViewAsExit();
  if (!previewing) return null;
  return (
    <>
      <div
        data-mobile-view-as-bar
        className="shrink-0 flex items-center gap-2 pl-4 text-sm text-(--t-text-primary)"
        style={{ height: 48, background: "color-mix(in srgb, var(--t-accent) 12%, var(--t-bg-chrome))" }}
      >
        <Icon icon="lucide:scan-eye" width={18} style={{ color: "var(--t-accent)" }} />
        <span className="min-w-0 flex-1 truncate">{t("members.viewAs.viewingAs", { name })}</span>
        <PreviewStatus />
        <button data-view-as-close aria-label={t("members.viewAs.exit")} className="vt-icon-btn shrink-0" style={{ width: 48, height: 48 }} onClick={exitFlow.requestExit}>
          <Icon icon="lucide:x" width={20} />
        </button>
      </div>
      <ViewAsExitConfirm exit={exitFlow} />
    </>
  );
}
