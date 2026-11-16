import { MemberAccessPanel } from "@/components/preview/MemberAccessPanel";
import { RoleAccessPanel } from "@/components/preview/RoleAccessPanel";
import { WhyPanel } from "@/components/preview/WhyPanel";
import { usePreviewStore } from "@/stores/previewStore";
import BottomSheet from "../sheets/BottomSheet";
import MobileViewAsDraftBar from "./MobileViewAsDraftBar";

export default function MobileViewAsSheets() {
  const side = usePreviewStore((s) => s.side);
  const subjectType = usePreviewStore((s) => s.session?.subject.type);
  const closeSide = usePreviewStore((s) => s.closeSide);
  if (side?.kind === "access") {
    return (
      <BottomSheet onClose={closeSide} footer={<MobileViewAsDraftBar />}>
        <div data-vt-hit-scope>{subjectType === "role" ? <RoleAccessPanel /> : <MemberAccessPanel />}</div>
      </BottomSheet>
    );
  }
  if (side?.kind !== "why") return null;
  return (
    <BottomSheet onClose={closeSide}>
      <div data-vt-hit-scope><WhyPanel /></div>
    </BottomSheet>
  );
}
