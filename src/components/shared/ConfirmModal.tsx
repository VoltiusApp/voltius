import { Icon } from "@iconify/react";
import { Modal, ModalCard } from "./Modal";

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
      <ModalCard className="p-6 flex flex-col gap-4 min-w-[21.333rem] max-w-[26.667rem]">
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
            className="btn btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="btn btn-danger px-4 py-2 rounded-lg text-sm font-medium"
          >
            {confirmLabel}
          </button>
        </div>
      </ModalCard>
    </Modal>
  );
}
