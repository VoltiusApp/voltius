import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "./Modal";

type Tone = "danger" | "warning" | "primary";

const TONES: Record<Tone, { accent: string; icon: string; button: string }> = {
  danger: { accent: "var(--t-status-error)", icon: "lucide:triangle-alert", button: "btn btn-danger" },
  warning: { accent: "var(--t-status-warning)", icon: "lucide:lock", button: "btn btn-warning" },
  primary: { accent: "var(--t-accent)", icon: "lucide:info", button: "btn btn-primary" },
};

interface Props {
  title: string;
  subtitle?: string;
  message: string;
  confirmLabel?: string;
  /** `danger` (default) for destruction; `warning` for reversible-but-serious; `primary` for a plain commit. */
  tone?: Tone;
  icon?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Disables the confirm button while a multi-step action is in flight. */
  busy?: boolean;
  /** Label shown on the confirm button while `busy` is true, in place of `confirmLabel`. */
  busyLabel?: string;
  children?: React.ReactNode;
}

export function ConfirmModal({ title, subtitle, message, confirmLabel, tone = "danger", icon, onConfirm, onCancel, busy = false, busyLabel, children }: Props) {
  const { t } = useTranslation();
  const style = TONES[tone];
  return (
    <Modal onClose={onCancel} onEnter={busy ? undefined : onConfirm}>
      <ModalCard className="p-6 flex flex-col gap-4 min-w-[21.333rem] max-w-[26.667rem]">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `color-mix(in srgb, ${style.accent} 15%, transparent)` }}
          >
            <Icon icon={icon ?? style.icon} width={16} style={{ color: style.accent }} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-(--t-text-bright)">{title}</h2>
            {subtitle && <p className="text-xs text-(--t-text-dim)">{subtitle}</p>}
          </div>
        </div>
        <p className="text-sm text-(--t-text-secondary)">{message}</p>
        {children}
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
            className={`${style.button} px-4 py-2 rounded-lg text-sm font-medium`}
          >
            {busy && busyLabel ? busyLabel : (confirmLabel ?? t("common.action.confirm"))}
          </button>
        </div>
      </ModalCard>
    </Modal>
  );
}
