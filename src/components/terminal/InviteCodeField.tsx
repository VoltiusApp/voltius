import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { writeClipboard } from "@/utils/clipboard";

export function InviteCodeField({ code, autoCopied = false }: { code: string; autoCopied?: boolean }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Manual copy flashes for 2s (the click itself is the feedback). Auto-copy has no
  // click to anchor to, so it must persist until something else changes it.
  const showCopied = (persist: boolean) => {
    setCopied(true);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (!persist) timeoutRef.current = setTimeout(() => setCopied(false), 2000);
  };

  // React to autoCopied flipping true after mount, not just its value at mount time.
  useEffect(() => {
    if (autoCopied) showCopied(true);
  }, [autoCopied]);

  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);

  const handleCopy = async () => {
    await writeClipboard(code);
    showCopied(false);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        readOnly
        className="flex-1 text-[11px] px-2.5 py-1.5 rounded-md outline-hidden font-mono"
        style={{
          background: "var(--t-bg-elevated)",
          border: "1px solid var(--t-border)",
          color: "var(--t-text-primary)",
        }}
        value={code}
        onFocus={(e) => e.target.select()}
      />
      <button
        className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs shrink-0 transition-colors"
        style={{
          background: copied ? "color-mix(in srgb, var(--t-accent) 15%, transparent)" : "var(--t-bg-elevated)",
          color: copied ? "var(--t-accent)" : "var(--t-text-secondary)",
          border: "1px solid var(--t-border)",
        }}
        onClick={handleCopy}
      >
        <Icon icon={copied ? "lucide:check" : "lucide:copy"} width={12} />
        {copied ? t("terminal.shared.copied") : t("common.action.copy")}
      </button>
    </div>
  );
}
