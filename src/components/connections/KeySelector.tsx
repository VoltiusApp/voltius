import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SshKey } from "@/types";
import { PickerSurface } from "@/components/shared/PickerSurface";
import {
  PickerDivider,
  PickerFooterAction,
  PickerOption,
  PickerTrigger,
} from "@/components/shared/pickerParts";

interface Props {
  value: string | null;
  keys: SshKey[];
  onChange: (id: string | null) => void;
  onGoToKeychain: () => void;
}

export default function KeySelector({ value, keys, onChange, onGoToKeychain }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selected = keys.find((k) => k.id === value) ?? null;
  const displayLabel = selected ? (selected.name ?? t("connections.keySelector.unnamedKey")) : t("connections.keySelector.inlinePrivateKey");

  return (
    <div>
      <PickerTrigger
        buttonRef={buttonRef}
        icon={selected ? "lucide:key" : "lucide:file-key"}
        label={displayLabel}
        filled={!!selected}
        open={open}
        onToggle={() => setOpen((o) => !o)}
        trailing={selected?.key_type ? (
          <span className="text-[10px] text-(--t-text-dim) shrink-0">{selected.key_type}</span>
        ) : undefined}
      />

      <PickerSurface open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} title={t("connections.common.sshKey")}>
        <PickerOption
          icon="lucide:file-key"
          label={t("connections.keySelector.inlinePrivateKey")}
          active={value === null}
          onClick={() => { onChange(null); setOpen(false); }}
        />

        {keys.length > 0 && <PickerDivider />}
        {keys.map((key) => (
          <PickerOption
            key={key.id}
            icon="lucide:key"
            label={key.name ?? t("connections.keySelector.unnamedKey")}
            labelTone="primary"
            badge={key.key_type ? (
              <span className="text-[10px] shrink-0 text-(--t-text-dim)">{key.key_type}</span>
            ) : undefined}
            active={value === key.id}
            onClick={() => { onChange(key.id); setOpen(false); }}
          />
        ))}

        <PickerDivider edge />
        <PickerFooterAction
          icon="lucide:key-round"
          label={t("connections.common.manageInKeychain")}
          trailingIcon="lucide:arrow-right"
          onClick={() => { setOpen(false); onGoToKeychain(); }}
        />
      </PickerSurface>
    </div>
  );
}
