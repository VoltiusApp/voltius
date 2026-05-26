import { useState } from "react";
import { Icon } from "@iconify/react";
import { DecisionPanel } from "./DecisionPanel";

export function PassphrasePromptPanel({
  onSubmit,
  onCancel,
}: {
  onSubmit: (passphrase: string, save: boolean) => void;
  onCancel?: () => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [showPassphrase, setShowPassphrase] = useState(false);

  return (
    <DecisionPanel
      tone="secure"
      icon={<Icon icon="lucide:lock" width={14} className="text-[var(--t-text-dim)] shrink-0" />}
      title="KEY PASSPHRASE REQUIRED"
      description="This key is encrypted. Enter the passphrase to continue."
      actions={[
        {
          label: "Connect & Save",
          disabled: !passphrase,
          onClick: () => onSubmit(passphrase, true),
        },
        {
          label: "Connect",
          variant: "secondary",
          disabled: !passphrase,
          onClick: () => onSubmit(passphrase, false),
        },
        {
          label: "Cancel",
          variant: "ghost",
          onClick: onCancel,
        },
      ]}
    >
      <div className="w-full relative">
        <input
          type={showPassphrase ? "text" : "password"}
          value={passphrase}
          onChange={(event) => setPassphrase(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && passphrase) onSubmit(passphrase, false);
          }}
          placeholder="Passphrase"
          autoFocus
          className="w-full px-3 pr-9 py-2 rounded-lg text-sm outline-none bg-[var(--t-bg-base)] border border-[var(--t-border)] text-[var(--t-text-primary)] focus:border-[var(--t-accent)]"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShowPassphrase((value) => !value)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--t-text-dim)] hover:text-[var(--t-text-primary)] transition-colors"
        >
          <Icon icon={showPassphrase ? "lucide:eye-off" : "lucide:eye"} width={14} />
        </button>
      </div>
    </DecisionPanel>
  );
}
