import { WhyPanel } from "@/components/preview/WhyPanel";
import { usePreviewStore } from "@/stores/previewStore";
import BottomSheet from "../sheets/BottomSheet";

export default function MobileViewAsSheets() {
  const side = usePreviewStore((s) => s.side);
  const closeSide = usePreviewStore((s) => s.closeSide);
  if (side?.kind !== "why") return null;
  return (
    <BottomSheet onClose={closeSide}>
      <div data-vt-hit-scope><WhyPanel /></div>
    </BottomSheet>
  );
}
