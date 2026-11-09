import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useCopiedFlash } from "@/hooks/useCopiedFlash";
import { writeClipboard } from "@/utils/clipboard";

interface Props {
  value: string;
  mono?: boolean;
  ariaLabel?: string;
  extra?: ReactNode;
}

export function CopySecretField({ value, mono = false, ariaLabel, extra }: Props) {
  const { t } = useTranslation();
  const { copied, flash } = useCopiedFlash(2000);

  const copy = async () => {
    await writeClipboard(value);
    flash();
  };

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={value}
        aria-label={ariaLabel}
        onFocus={(e) => e.currentTarget.select()}
        className={`flex-1 min-w-0 px-2 py-1 rounded-md bg-(--t-bg-elevated) border border-(--t-border) text-[10px] text-(--t-text-secondary) outline-none${mono ? " font-mono" : ""}`}
      />
      <button
        onClick={() => void copy()}
        className="px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0"
        style={{ background: "var(--t-accent)", color: "var(--t-on-accent, #fff)" }}
      >
        {copied ? t("members.joinLinks.copied") : t("members.joinLinks.copy")}
      </button>
      {extra}
    </div>
  );
}
