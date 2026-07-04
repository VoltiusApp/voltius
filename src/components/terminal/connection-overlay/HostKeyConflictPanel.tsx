import { useTranslation } from "react-i18next";
import { DecisionPanel } from "./DecisionPanel";
import type { HostKeyConflictAction, HostKeyConflictEvent } from "./types";
import { truncateFp } from "./utils";

export function HostKeyConflictPanel({
  conflict,
  resolving,
  onResolve,
}: {
  conflict: HostKeyConflictEvent;
  resolving: boolean;
  onResolve: (action: HostKeyConflictAction) => void;
}) {
  const { t } = useTranslation();
  return (
    <DecisionPanel
      tone="warning"
      icon={<WarningIcon />}
      title={t("terminal.overlay.hostKeyConflict.title")}
      description={(
        <>
          {t("terminal.overlay.hostKeyConflict.descriptionPrefix")}
          <span className="font-mono text-text-primary">{conflict.host}:{conflict.port}</span>
          {t("terminal.overlay.hostKeyConflict.descriptionSuffix")}
        </>
      )}
      actions={[
        {
          label: t("terminal.overlay.hostKeyConflict.replace"),
          disabled: resolving,
          onClick: () => onResolve("replace"),
        },
        {
          label: t("terminal.overlay.hostKeyConflict.addAsNew"),
          variant: "secondary",
          disabled: resolving,
          onClick: () => onResolve("add_new"),
        },
        {
          label: t("terminal.overlay.hostKeyConflict.abort"),
          variant: "ghost",
          disabled: resolving,
          onClick: () => onResolve("abort"),
        },
      ]}
    >
      <div className="w-full space-y-2 text-left">
        {conflict.stored_entries.slice(0, 2).map((entry) => (
          <div key={entry.id} className="p-2 rounded-sm bg-(--t-bg-elevated)">
            <p className="text-(--t-text-dim) text-xs mb-0.5">{t("terminal.overlay.hostKeyConflict.stored")}</p>
            <p className="font-mono text-xs text-text-secondary break-all">{truncateFp(entry.fingerprint)}</p>
          </div>
        ))}
        <div className="p-2 rounded-sm bg-yellow-500/5 border border-yellow-500/20">
          <p className="text-yellow-400 text-xs mb-0.5">{t("terminal.overlay.hostKeyConflict.received")}</p>
          <p className="font-mono text-xs text-text-secondary break-all">{truncateFp(conflict.new_fingerprint)}</p>
        </div>
      </div>
    </DecisionPanel>
  );
}

function WarningIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
