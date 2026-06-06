import { Icon } from "@iconify/react";
import { Modal } from "./Modal";
import type { PendingCascade } from "@/hooks/useVaultCascade";

interface Props {
  cascade: PendingCascade;
  onConfirm: () => void;
  onCancel: () => void;
}

const typeIcon: Record<string, string> = {
  identity: "lucide:user",
  key: "lucide:key",
  connection: "lucide:server",
};

const typeLabel: Record<string, string> = {
  identity: "Identity",
  key: "SSH Key",
  connection: "Host",
};

export function VaultCascadeModal({ cascade, onConfirm, onCancel }: Props) {
  const verb = cascade.operation === "move" ? "Move" : "Copy";

  return (
    <Modal onClose={onCancel} onEnter={onConfirm}>
      <div
        className="p-6 rounded-2xl flex flex-col gap-4 mx-4 bg-(--t-bg-card) border border-(--t-border) min-w-[21.333rem] max-w-[26.667rem]"
        style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
      >
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--t-accent) 15%, transparent)" }}
          >
            <Icon
              icon={cascade.operation === "move" ? "lucide:folder-input" : "lucide:copy"}
              width={16}
              className="text-(--t-accent)"
            />
          </div>
          <h2 className="text-sm font-semibold text-(--t-text-bright)">
            {verb} linked items to{" "}
            <span className="text-(--t-accent)">{cascade.targetVaultName}</span>?
          </h2>
        </div>

        <p className="text-sm text-(--t-text-secondary)">
          {cascade.description ?? (
            <>
              The following linked items are in a different vault and will also be{" "}
              {cascade.operation === "move" ? "moved" : "copied"}:
            </>
          )}
        </p>

        <div className="flex flex-col gap-2">
          {cascade.items.map((item, i) => (
            <div
              key={i}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-(--t-bg-elevated)"
            >
              <Icon
                icon={typeIcon[item.type]}
                width={14}
                className="text-(--t-text-secondary) shrink-0"
              />
              <span className="text-xs text-(--t-text-secondary)">{typeLabel[item.type]}</span>
              <span className="text-sm font-medium text-(--t-text-bright) truncate">
                {item.label}
              </span>
            </div>
          ))}
        </div>

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
            className="px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: "var(--t-accent)" }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.85")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            {verb} All
          </button>
        </div>
      </div>
    </Modal>
  );
}
