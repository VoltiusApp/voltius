import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";
import { PairDeviceBody } from "@/components/shared/PairDeviceBody";

export default function PairDeviceSheet({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <BottomSheet title={t("layout.sync.local.pair.title")} onClose={onClose}>
      <div data-pair-sheet className="px-4 pb-4">
        <PairDeviceBody onClose={onClose} />
      </div>
    </BottomSheet>
  );
}
