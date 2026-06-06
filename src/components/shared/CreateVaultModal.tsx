import { Icon } from "@iconify/react";
import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";

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
    <Modal onClose={onCancel} blur>
      <div
        className="p-6 rounded-2xl flex flex-col gap-5 mx-4 bg-(--t-bg-card) border border-(--t-border)"
        style={{ width: "22rem", boxShadow: "0 16px 48px rgba(0,0,0,0.5)" }}
      >
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
            className="w-full px-3 py-2.5 rounded-xl text-sm outline-hidden transition-all"
            style={{
              background: "var(--t-bg-elevated)",
              color: "var(--t-text-primary)",
              border: "1px solid var(--t-border)",
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
            onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
          />
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors bg-(--t-bg-elevated) text-(--t-text-secondary) border border-(--t-border)"
            onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-bg-card-hover)")}
            onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim()}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white transition-opacity disabled:opacity-40"
            style={{ background: "var(--t-accent)" }}
            onMouseEnter={(e) => { if (name.trim()) e.currentTarget.style.opacity = "0.85"; }}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
          >
            Create Vault
          </button>
        </div>
      </div>
    </Modal>
  );
}
