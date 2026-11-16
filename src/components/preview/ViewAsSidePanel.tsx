import { usePreviewStore } from "@/stores/previewStore";
import { MemberAccessPanel } from "@/components/preview/MemberAccessPanel";
import { RoleAccessPanel } from "@/components/preview/RoleAccessPanel";
import { WhyPanel } from "@/components/preview/WhyPanel";
import { CloseButton } from "@/components/preview/CloseButton";

function AccessSlot() {
  const subjectType = usePreviewStore((s) => s.session?.subject.type);
  if (!subjectType) return null;
  return subjectType === "member" ? <MemberAccessPanel /> : <RoleAccessPanel />;
}

export function ViewAsSidePanel() {
  const side = usePreviewStore((s) => s.side);
  if (!side) return null;
  return (
    <aside
      data-testid="view-as-side-panel"
      className="w-80 shrink-0 flex flex-col border-l overflow-hidden"
      style={{ background: "var(--t-bg-modal)", borderColor: "var(--t-border)" }}
    >
      <div className="shrink-0 flex justify-end p-2">
        <CloseButton testId="view-as-side-close" onClick={() => usePreviewStore.getState().closeSide()} />
      </div>
      <div className="flex-1 overflow-y-auto">{side.kind === "access" ? <AccessSlot /> : <WhyPanel key={side.objectId} />}</div>
    </aside>
  );
}
