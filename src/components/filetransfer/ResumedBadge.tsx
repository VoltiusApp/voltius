import { useTranslation } from "react-i18next";
import { InfoTooltip } from "@/components/shared/InfoTooltip";
import { formatSize } from "./SFTPTypes";

export function ResumedBadge({ at }: { at: number }) {
  const { t } = useTranslation();
  return (
    <InfoTooltip icon="lucide:history" iconColor="var(--t-text-dim)" width={11} placement="top">
      <div className="mb-1 font-medium text-(--t-text-primary)">{t("fileTransfer.queue.resumedAt", { size: formatSize(at) })}</div>
      <p className="m-0">{t("fileTransfer.queue.resumedTooltip")}</p>
    </InfoTooltip>
  );
}
