import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { usePreviewStore } from "@/stores/previewStore";

export function PreviewStatus() {
  const { t } = useTranslation();
  const status = usePreviewStore((s) => s.status);
  const error = usePreviewStore((s) => s.error);
  const detail = usePreviewStore((s) => s.errorDetail);
  if (status === "loading") {
    return (
      <span data-testid="view-as-loading" className="flex items-center gap-1" style={{ color: "var(--t-text-dim)" }}>
        <Icon icon="lucide:loader-circle" width={12} className="animate-spin" />
        {t("members.viewAs.loading")}
      </span>
    );
  }
  if (status !== "error") return null;
  return (
    <>
      <span data-testid="view-as-error" className="min-w-0 max-w-64 truncate" title={detail ?? undefined} style={{ color: "var(--t-status-error)" }}>
        {error ?? t("members.viewAs.failed")}
      </span>
      <button data-testid="view-as-retry" className="btn btn-ghost" onClick={() => void usePreviewStore.getState().refetch()}>
        {t("common.action.retry")}
      </button>
    </>
  );
}
