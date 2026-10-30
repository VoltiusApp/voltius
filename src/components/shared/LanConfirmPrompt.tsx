import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SheetActionRow, type SheetAction } from "@/components/mobile/sheets/SheetActionRow";
import { SyncInlineAction, type SyncMenuVariant } from "@/components/shared/SyncSectionParts";
import { logFailure } from "@/lib/logger";

export function LanConfirmPrompt({ kind, variant, icon, label, failed, ready = true, run, onDone, onCancel, children }: {
  kind: string;
  variant: SyncMenuVariant;
  icon: string;
  label: string;
  failed: string;
  ready?: boolean;
  run: () => Promise<void>;
  onDone: () => void;
  onCancel: () => void;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setError(false);
    try {
      await run();
      onDone();
    } catch (e) {
      logFailure(`lan-sync ${kind}`)(e);
      setError(true);
      setBusy(false);
    }
  };

  const sheet = variant === "sheet";
  const actions: SheetAction[] = [
    { slug: `${kind}-confirm`, icon, danger: true, disabled: busy || !ready, label, onTap: () => void confirm() },
    { slug: `${kind}-cancel`, icon: "lucide:x", label: t("layout.sync.local.pair.cancel"), onTap: onCancel },
  ];

  return (
    <div {...{ [`data-lan-${kind}-confirm`]: "" }} className={`space-y-1.5 leading-relaxed ${sheet ? "text-xs" : "text-[10px]"} text-(--t-text-dim)`}>
      {children}
      {error && (
        <p {...{ [`data-lan-${kind}-error`]: "" }} role="alert" className="text-(--t-danger,#e5484d)">
          {failed}
        </p>
      )}
      {sheet ? (
        actions.map((a) => <SheetActionRow key={a.slug} attr="lan-action" it={a} />)
      ) : (
        <div className="flex gap-3">
          {actions.map((a) => <SyncInlineAction key={a.slug} slug={a.slug} disabled={a.disabled} onClick={a.onTap} label={a.label} />)}
        </div>
      )}
    </div>
  );
}
