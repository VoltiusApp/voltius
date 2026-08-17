import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { statusSurface } from "./statusSurface";

interface Props {
  error: string;
  onDismiss: () => void;
}

export function ErrorBanner({ error, onDismiss }: Props) {
  const { t } = useTranslation();
  return (
    <div
      className="mx-5 mt-3 flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs"
      style={statusSurface("error")}
    >
      <Icon icon="lucide:circle-alert" width={14} />
      <span className="flex-1">{error}</span>
      <button className="underline opacity-70 hover:opacity-100 transition-opacity" onClick={onDismiss}>
        {t("shared.errorBanner.dismiss")}
      </button>
    </div>
  );
}
