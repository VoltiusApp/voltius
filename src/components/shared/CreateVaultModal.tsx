import { Icon } from "@iconify/react";
import { useEffect, useRef, useState } from "react";
import { Modal, ModalCard } from "./Modal";

interface Props {
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function CreateVaultModal({ onConfirm, onCancel }: Props) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 60);
  }, []);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onConfirm(trimmed);
  };

  return (
    <Modal onClose={onCancel}>
      <ModalCard className="p-6 flex flex-col gap-5" style={{ width: "22rem" }}>
        {/* Header */}
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--t-accent) 18%, transparent)" }}
          >
            <Icon icon="lucide:vault" width={18} className="text-(--t-accent)" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-(--t-text-bright)">New Vault</h2>
            <p className="text-xs text-(--t-text-dim) mt-0.5">Vaults keep your credentials organized</p>
          </div>
        </div>

        {/* Input */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-(--t-text-secondary)">Vault name</label>
          <input
            ref={inputRef}
            type="text"
            placeholder="e.g. Work, Personal, Staging…"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
              if (e.key === "Escape") onCancel();
            }}
            className="form-input w-full px-3 py-2.5 rounded-xl text-sm outline-hidden"
            style={{
              background: "var(--t-bg-elevated)",
              color: "var(--t-text-primary)",
              border: "1px solid var(--t-border)",
            }}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onCancel}
            className="btn btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="btn btn-primary px-4 py-2 rounded-lg text-sm font-medium"
          >
            Create Vault
          </button>
        </div>
      </ModalCard>
    </Modal>
  );
}
