import { usePreviewStore } from "@/stores/previewStore";
import { ViewAsDraftActions, ViewAsSaveConfirm } from "@/components/preview/ViewAsDraftActions";

export default function MobileViewAsDraftBar({ safeBottom = false }: { safeBottom?: boolean }) {
  const hasDraft = usePreviewStore((s) => s.draft !== null);
  if (!hasDraft) return null;
  return (
    <>
      <div
        data-mobile-view-as-draft
        data-snackbar-anchor
        className="shrink-0 flex items-center gap-2 px-4 text-sm border-t border-(--t-border) text-(--t-text-primary)"
        style={{
          height: safeBottom ? "calc(56px + var(--vt-safe-bottom))" : 56,
          paddingBottom: safeBottom ? "var(--vt-safe-bottom)" : undefined,
          background: "var(--t-bg-chrome)",
        }}
      >
        <ViewAsDraftActions size="touch" />
      </div>
      <ViewAsSaveConfirm />
    </>
  );
}
