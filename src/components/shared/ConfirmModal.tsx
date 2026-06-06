import { Icon } from "@iconify/react";
import { Modal } from "./Modal";

interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({ title, message, confirmLabel = "Confirm", onConfirm, onCancel }: Props) {
  return (
    <Modal onClose={onCancel} onEnter={onConfirm}>
      <div
        className="p-6 rounded-2xl flex flex-col gap-4 mx-4 bg-(--t-bg-card) border border-(--t-border) min-w-[21.333rem] max-w-[26.667rem]"
        style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--t-status-error) 15%, transparent)" }}
          >
            <Icon icon="lucide:triangle-alert" width={16} className="text-(--t-status-error)" />
          </div>
          <h2 className="text-sm font-semibold text-(--t-text-bright)">{title}</h2>
        </div>
        <p className="text-sm text-(--t-text-secondary)">{message}</p>
        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-(--t-bg-elevated) text-(--t-text-secondary) border border-(--t-border)"
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-(--t-status-error) text-white"
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
