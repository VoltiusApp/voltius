import type { CSSProperties, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useCopiedFlash } from "@/hooks/useCopiedFlash";
import { logFailure } from "@/lib/logger";
import { writeClipboard } from "@/utils/clipboard";

interface CopyButtonProps {
  value: string;
  label: string;
  className: string;
  style?: CSSProperties;
  title?: string;
  icon?: ReactNode;
}

export function CopyButton({ value, label, className, style, title, icon }: CopyButtonProps) {
  const { t } = useTranslation();
  const { copied, flash } = useCopiedFlash(2000);
  const copy = () => writeClipboard(value).then(() => flash(), logFailure("copy to clipboard"));
  return (
    <button onClick={() => void copy()} title={title} className={className} style={style}>
      {icon}
      {copied ? t("members.joinLinks.copied") : label}
    </button>
  );
}

interface Props {
  value: string;
  mono?: boolean;
  ariaLabel?: string;
  extra?: ReactNode;
}

export function CopySecretField({ value, mono = false, ariaLabel, extra }: Props) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        value={value}
        aria-label={ariaLabel}
        onFocus={(e) => e.currentTarget.select()}
        className={`flex-1 min-w-0 px-2 py-1 rounded-md bg-(--t-bg-elevated) border border-(--t-border) text-[10px] text-(--t-text-secondary) outline-none${mono ? " font-mono" : ""}`}
      />
      <CopyButton
        value={value}
        label={t("members.joinLinks.copy")}
        className="px-2.5 py-1 rounded-lg text-[11px] font-medium shrink-0"
        style={{ background: "var(--t-accent)", color: "var(--t-on-accent, #fff)" }}
      />
      {extra}
    </div>
  );
}
