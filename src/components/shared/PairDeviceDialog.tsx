import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { PairDeviceBody } from "@/components/shared/PairDeviceBody";
import PairDeviceSheet from "@/components/mobile/sheets/PairDeviceSheet";
import { closePairDeviceDialog, usePairDeviceDialogStore } from "@/stores/pairDeviceDialogStore";
import { useIsMobile } from "@/utils/platform";

export function PairDeviceDialog() {
  const { t } = useTranslation();
  const open = usePairDeviceDialogStore((s) => s.open);
  const isMobile = useIsMobile();
  if (!open) return null;
  if (isMobile) return <PairDeviceSheet onClose={closePairDeviceDialog} />;
  return (
    <Modal onClose={closePairDeviceDialog}>
      <ModalCard className="p-6 flex flex-col gap-4 w-[min(26.667rem,calc(100vw-2rem))]">
        <h2 className="text-base font-semibold text-(--t-text-primary)">{t("layout.sync.local.pair.title")}</h2>
        <PairDeviceBody onClose={closePairDeviceDialog} />
      </ModalCard>
    </Modal>
  );
}
