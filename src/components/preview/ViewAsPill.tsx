import { useEffect } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { FloatingPill, escapeIsFree } from "@/components/shared/FloatingPill";
import { usePreviewStore } from "@/stores/previewStore";
import { useSubjectLabel } from "@/components/preview/PreviewScope";
import { ViewAsDraftActions, ViewAsSaveConfirm } from "@/components/preview/ViewAsDraftActions";
import { PreviewStatus } from "@/components/preview/PreviewStatus";
import { ViewAsExitConfirm } from "@/components/preview/ViewAsExitConfirm";
import { useViewAsExit } from "@/components/preview/useViewAsExit";

export function ViewAsPill() {
  const { t } = useTranslation();
  const hasDraft = usePreviewStore((s) => s.draft !== null);
  const saving = usePreviewStore((s) => s.saving);
  const name = useSubjectLabel();
  const exitFlow = useViewAsExit();
  const { requestExit } = exitFlow;

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && escapeIsFree(e)) requestExit();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  return (
    <>
      <FloatingPill testId="view-as-pill">
        <Icon icon="lucide:scan-eye" width={14} style={{ color: "var(--t-accent)" }} />
        <span>{t("members.viewAs.viewingAs", { name })}</span>
        <PreviewStatus />
        {hasDraft && (
          <>
            <span style={{ color: "var(--t-text-dim)" }}>·</span>
            <ViewAsDraftActions />
            <span className="self-stretch w-px" style={{ background: "var(--t-border)" }} />
          </>
        )}
        <button data-testid="view-as-exit" className="btn btn-ghost" disabled={saving} onClick={requestExit}>
          {t("members.viewAs.exit")}
        </button>
      </FloatingPill>
      <ViewAsSaveConfirm />
      <ViewAsExitConfirm exit={exitFlow} />
    </>
  );
}
