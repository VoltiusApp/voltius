import { useEffect } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useBackInterceptor } from "@/hooks/useBackInterceptor";
import { tabState, useMobileNavStore } from "@/stores/mobileNavStore";
import { usePreviewStore } from "@/stores/previewStore";
import { useSubjectLabel } from "@/components/preview/PreviewScope";
import { PreviewStatus } from "@/components/preview/PreviewStatus";
import { ViewAsExitConfirm } from "@/components/preview/ViewAsExitConfirm";
import { useViewAsExit } from "@/components/preview/useViewAsExit";
import { greyedTapProps } from "../tapOrExplain";

function restoreReturn() {
  const { previewReturn } = useMobileNavStore.getState();
  if (!previewReturn) return;
  useMobileNavStore.setState((s) => ({ ...tabState(s, previewReturn.tab, previewReturn.stack), previewReturn: null }));
}

export default function MobileViewAsBar() {
  const { t } = useTranslation();
  const previewing = usePreviewStore((s) => s.session !== null);
  const name = useSubjectLabel();
  const showAccess = usePreviewStore((s) => s.showAccess);
  const saving = usePreviewStore((s) => s.saving);
  const exitFlow = useViewAsExit({ afterExit: restoreReturn });
  const back = () => {
    if (saving) return;
    const { pendingConfirm, cancelSave } = usePreviewStore.getState();
    if (pendingConfirm) cancelSave();
    else if (exitFlow.confirming) exitFlow.cancel();
    else exitFlow.requestExit();
  };
  // Registered on entering, at the Hosts root, so pushed pages, other tabs and sheets take back first.
  useBackInterceptor(previewing, back);
  useEffect(() => {
    if (previewing) return;
    useMobileNavStore.getState().setPreviewReturn(null);
    exitFlow.cancel();
  }, [previewing]);
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
        <button data-view-as-access aria-label={t("mobile.viewAs.editAccess")} className="vt-icon-btn shrink-0" style={{ width: 48, height: 48 }} onClick={showAccess}>
          <Icon icon="lucide:sliders-horizontal" width={20} />
        </button>
        <button
          data-view-as-close
          aria-label={t("members.viewAs.exit")}
          className="vt-icon-btn shrink-0 aria-disabled:opacity-40"
          style={{ width: 48, height: 48 }}
          {...greyedTapProps(saving ? t("common.state.saving") : null, exitFlow.requestExit)}
        >
          <Icon icon="lucide:x" width={20} />
        </button>
      </div>
      <ViewAsExitConfirm exit={exitFlow} />
    </>
  );
}
