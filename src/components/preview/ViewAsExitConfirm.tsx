import { useTranslation } from "react-i18next";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { useSubjectLabel } from "@/components/preview/PreviewScope";
import type { useViewAsExit } from "./useViewAsExit";

export function ViewAsExitConfirm({ exit }: { exit: ReturnType<typeof useViewAsExit> }) {
  const { t } = useTranslation();
  const name = useSubjectLabel();
  if (!exit.confirming) return null;
  return (
    <ConfirmModal
      tone="warning"
      title={t("members.viewAs.discardDraft.title")}
      message={t("members.viewAs.discardDraft.body", { name })}
      confirmLabel={t("members.viewAs.discardDraft.confirm")}
      onCancel={exit.cancel}
      onConfirm={exit.confirm}
    />
  );
}
