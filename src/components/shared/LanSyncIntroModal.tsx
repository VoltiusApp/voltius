import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { confirmLanSyncIntro, useLanSyncIntroStore } from "@/services/lanSyncIntro";

const noop = () => {};

export function LanSyncIntroModal() {
  const { t } = useTranslation();
  const open = useLanSyncIntroStore((s) => s.open);
  if (!open) return null;
  return (
    <Modal onClose={noop} onEnter={confirmLanSyncIntro}>
      <ModalCard className="p-6 flex flex-col gap-4 w-[min(26.667rem,calc(100vw-2rem))]">
        <p className="text-sm text-(--t-text-secondary)">{t("layout.sync.local.intro")}</p>
        <div className="flex justify-end">
          <button
            autoFocus
            onClick={confirmLanSyncIntro}
            className="btn btn-primary px-4 py-2 rounded-lg text-sm font-medium"
          >
            {t("layout.sync.local.introContinue")}
          </button>
        </div>
      </ModalCard>
    </Modal>
  );
}
