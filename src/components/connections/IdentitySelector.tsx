import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { Identity } from "@/types";
import { PickerSurface } from "@/components/shared/PickerSurface";
import {
  PickerDivider,
  PickerFooterAction,
  PickerOption,
  PickerTrigger,
} from "@/components/shared/pickerParts";

interface Props {
  value: string | null;
  identities: Identity[];
  onChange: (id: string | null) => void;
  onGoToKeychain: () => void;
}

export default function IdentitySelector({ value, identities, onChange, onGoToKeychain }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selected = identities.find((i) => i.id === value) ?? null;
  const displayLabel = selected ? (selected.name ?? selected.username) : t("connections.identitySelector.noIdentityInline");

  return (
    <div>
      <PickerTrigger
        buttonRef={buttonRef}
        icon={selected ? "lucide:user-check" : "lucide:user-x"}
        label={displayLabel}
        filled={!!selected}
        open={open}
        onToggle={() => setOpen((o) => !o)}
      />

      <PickerSurface open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} title={t("connections.identitySelector.title")}>
        <PickerOption
          icon="lucide:user-x"
          label={t("connections.identitySelector.noIdentityInline")}
          active={value === null}
          onClick={() => { onChange(null); setOpen(false); }}
        />

        {identities.length > 0 && <PickerDivider />}
        {identities.map((identity) => (
          <PickerOption
            key={identity.id}
            icon="lucide:user"
            label={identity.name ?? identity.username}
            labelTone="primary"
            sublabel={identity.name ? identity.username : undefined}
            badge={(
              <span className="text-xs shrink-0 text-(--t-text-dim)">
                {identity.key_id ? t("connections.identitySelector.badgeKey") : t("connections.identitySelector.badgePwd")}
              </span>
            )}
            active={value === identity.id}
            onClick={() => { onChange(identity.id); setOpen(false); }}
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
