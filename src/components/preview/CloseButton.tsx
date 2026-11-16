import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";

export function CloseButton({ onClick, testId }: { onClick: () => void; testId?: string }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-testid={testId}
      title={t("common.close")}
      aria-label={t("common.close")}
      onClick={onClick}
      className="w-6 h-6 flex items-center justify-center rounded-sm"
      style={{ color: "var(--t-text-muted)" }}
    >
      <Icon icon="lucide:x" width={14} />
    </button>
  );
}
