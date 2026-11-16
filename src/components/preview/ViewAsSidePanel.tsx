import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { usePreviewStore } from "@/stores/previewStore";
import { MemberAccessPanel } from "@/components/preview/MemberAccessPanel";

function AccessSlot() {
  const subjectType = usePreviewStore((s) => s.session?.subject.type);
  return subjectType === "member" ? <MemberAccessPanel /> : null;
}

function WhySlot() {
  return null;
}

export function ViewAsSidePanel() {
  const { t } = useTranslation();
  const side = usePreviewStore((s) => s.side);
  if (!side) return null;
  return (
    <aside
      data-testid="view-as-side-panel"
      className="w-80 shrink-0 flex flex-col border-l overflow-hidden"
      style={{ background: "var(--t-bg-modal)", borderColor: "var(--t-border)" }}
    >
      <div className="shrink-0 flex justify-end p-2">
        <button
          data-testid="view-as-side-close"
          title={t("common.close")}
          aria-label={t("common.close")}
          onClick={() => usePreviewStore.getState().closeSide()}
          className="w-6 h-6 flex items-center justify-center rounded-sm"
          style={{ color: "var(--t-text-muted)" }}
        >
          <Icon icon="lucide:x" width={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">{side.kind === "access" ? <AccessSlot /> : <WhySlot />}</div>
    </aside>
  );
}
