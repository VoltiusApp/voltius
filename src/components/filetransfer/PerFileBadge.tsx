import { useTranslation } from "react-i18next";
import { InfoTooltip } from "@/components/shared/InfoTooltip";

export function PerFileBadge() {
  const { t } = useTranslation();
  return (
    <InfoTooltip icon="lucide:files" iconColor="var(--t-text-dim)" width={11} placement="top">
      <p className="m-0">{t("fileTransfer.perFileBadge.reason")}</p>
    </InfoTooltip>
  );
}
