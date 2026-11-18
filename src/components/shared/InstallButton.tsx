import { Icon } from "@iconify/react";

export function InstallButton({ label, busy, onClick, disabledReason = null, compact = false }: {
  label: string;
  busy: boolean;
  onClick: () => void;
  disabledReason?: string | null;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={disabledReason ?? undefined}
      disabled={busy || disabledReason !== null}
      onClick={onClick}
      className={compact
        ? "flex items-center gap-1 px-2 py-0.5 rounded-sm text-[10px] font-medium shrink-0 bg-(--t-bg-elevated) text-(--t-text-secondary) hover:text-(--t-text-primary) transition-colors"
        : "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium shrink-0 bg-(--t-accent) text-(--t-bg-base) transition-opacity hover:opacity-85"}
      style={{ opacity: busy ? 0.6 : disabledReason !== null ? 0.4 : undefined, cursor: disabledReason !== null ? "not-allowed" : undefined }}
    >
      <Icon icon={busy ? "lucide:loader" : "lucide:download"} width={compact ? 10 : 12} className={busy ? "animate-spin" : undefined} />
      {label}
    </button>
  );
}
