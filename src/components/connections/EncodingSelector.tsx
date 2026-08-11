import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { PickerSurface } from "@/components/shared/PickerSurface";
import { PickerDivider, PickerOption, PickerTrigger } from "@/components/shared/pickerParts";

const ENCODING_GROUPS: { groupKey: string; options: string[] }[] = [
  { groupKey: "unicode", options: ["utf-16le", "utf-16be"] },
  { groupKey: "westernEuropean", options: ["iso-8859-1", "iso-8859-15", "windows-1252"] },
  { groupKey: "centralEuropean", options: ["iso-8859-2", "windows-1250"] },
  { groupKey: "cyrillic", options: ["iso-8859-5", "koi8-r", "koi8-u", "windows-1251", "ibm866"] },
  { groupKey: "greek", options: ["iso-8859-7", "windows-1253"] },
  { groupKey: "hebrew", options: ["iso-8859-8", "windows-1255"] },
  { groupKey: "arabic", options: ["iso-8859-6", "windows-1256"] },
  { groupKey: "turkish", options: ["iso-8859-9", "windows-1254"] },
  { groupKey: "baltic", options: ["iso-8859-13", "windows-1257"] },
  { groupKey: "vietnamese", options: ["windows-1258"] },
  { groupKey: "chineseSimplified", options: ["gbk", "gb18030"] },
  { groupKey: "chineseTraditional", options: ["big5"] },
  { groupKey: "japanese", options: ["shift-jis", "euc-jp"] },
  { groupKey: "korean", options: ["euc-kr"] },
];

const ALL_OPTION_VALUES = ENCODING_GROUPS.flatMap((g) => g.options);

interface Props {
  value: string;
  onChange: (value: string) => void;
}

export default function EncodingSelector({ value, onChange }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const optionLabel = (val: string) => t(`connections.encodingSelector.options.${val}`);
  const selectedLabel = value
    ? (ALL_OPTION_VALUES.includes(value) ? optionLabel(value) : value)
    : t("connections.encodingSelector.utf8Default");

  return (
    <div>
      <PickerTrigger
        buttonRef={buttonRef}
        icon="lucide:binary"
        label={selectedLabel}
        filled={!!value}
        open={open}
        onToggle={() => setOpen((o) => !o)}
      />

      <PickerSurface open={open} onClose={() => setOpen(false)} anchorRef={buttonRef} title={t("connections.encodingSelector.title")}>
        {/* UTF-8 default */}
        <PickerOption
          icon="lucide:binary"
          label={t("connections.encodingSelector.utf8Default")}
          active={!value}
          onClick={() => { onChange(""); setOpen(false); }}
        />

        {ENCODING_GROUPS.map((group) => (
          <div key={group.groupKey}>
            <PickerDivider />
            <p className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-(--t-text-dim)">
              {t(`connections.encodingSelector.groups.${group.groupKey}`)}
            </p>
            {group.options.map((opt) => (
              <PickerOption
                key={opt}
                icon="lucide:binary"
                label={optionLabel(opt)}
                active={value === opt}
                onClick={() => { onChange(opt); setOpen(false); }}
              />
            ))}
          </div>
        ))}
      </PickerSurface>
    </div>
  );
}
