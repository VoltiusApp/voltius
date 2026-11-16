import { useTranslation } from "react-i18next";
import { MemberAccessPanel } from "@/components/preview/MemberAccessPanel";
import { RoleAccessPanel } from "@/components/preview/RoleAccessPanel";
import { useSubjectLabel } from "@/components/preview/PreviewScope";
import { WhyPanel } from "@/components/preview/WhyPanel";
import { usePreviewStore } from "@/stores/previewStore";
import BottomSheet from "../sheets/BottomSheet";
import MobileViewAsDraftBar from "./MobileViewAsDraftBar";

export default function MobileViewAsSheets() {
  const { t } = useTranslation();
  const side = usePreviewStore((s) => s.side);
  const subjectType = usePreviewStore((s) => s.session?.subject.type);
  const closeSide = usePreviewStore((s) => s.closeSide);
  const name = useSubjectLabel();
  if (side?.kind === "access") {
    return (
      <BottomSheet onClose={closeSide} title={t("members.viewAs.access.title", { name })} footer={<MobileViewAsDraftBar />}>
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
