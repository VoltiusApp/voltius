import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "./Modal";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  /** `danger` (default) for destruction; `warning` for reversible-but-serious. */
  tone?: "danger" | "warning";
  onConfirm: () => void;
  onCancel: () => void;
  /** Disables the confirm button while a multi-step action is in flight. */
  busy?: boolean;
  /** Label shown on the confirm button while `busy` is true, in place of `confirmLabel`. */
  busyLabel?: string;
}

export function ConfirmModal({ title, message, confirmLabel, tone = "danger", onConfirm, onCancel, busy = false, busyLabel }: Props) {
  const { t } = useTranslation();
  const accent = tone === "warning" ? "var(--t-status-warning)" : "var(--t-status-error)";
  const icon = tone === "warning" ? "lucide:lock" : "lucide:triangle-alert";
  const confirmClass = tone === "warning" ? "btn btn-warning" : "btn btn-danger";
  return (
    <Modal onClose={onCancel} onEnter={onConfirm}>
      <ModalCard className="p-6 flex flex-col gap-4 min-w-[21.333rem] max-w-[26.667rem]">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `color-mix(in srgb, ${accent} 15%, transparent)` }}
          >
            <Icon icon={icon} width={16} style={{ color: accent }} />
          </div>
          <h2 className="text-sm font-semibold text-(--t-text-bright)">{title}</h2>
        </div>
        <p className="text-sm text-(--t-text-secondary)">{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="btn btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
          >
            {t("common.action.cancel")}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`${confirmClass} px-4 py-2 rounded-lg text-sm font-medium`}
          >
            {busy && busyLabel ? busyLabel : (confirmLabel ?? t("common.action.confirm"))}
          </button>
        </div>
      </ModalCard>
    </Modal>
  );
}
