import { useTranslation } from "react-i18next";
import { formatSize } from "./SFTPTypes";

export function ResumedBadge({ at }: { at: number }) {
  const { t } = useTranslation();
  return (
    <span
      className="shrink-0 text-[10px] leading-none px-1 py-0.5 rounded-sm bg-(--t-bg-hover) text-(--t-text-dim)"
      title={t("fileTransfer.queue.resumedTooltip")}
    >
      {t("fileTransfer.queue.resumedAt", { size: formatSize(at) })}
    </span>
  );
}
