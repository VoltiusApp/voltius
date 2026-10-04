import type { ReactNode } from "react";
import { Icon } from "@iconify/react";

export function SectionHeader({ label, count, aside, compact, collapsed, onToggle, className }: {
  label: ReactNode;
  count?: number;
  aside?: ReactNode;
  compact?: boolean;
  collapsed?: boolean;
  onToggle?: () => void;
  className?: string;
}) {
  const text = compact ? "text-[10px]" : "text-xs";
  const body = (
    <>
      <span className={`${text} font-bold uppercase tracking-widest text-(--t-text-dim)`}>{label}</span>
      {count !== undefined && (
        <span className={`${text} px-1.5 py-0.5 rounded-md leading-none bg-(--t-bg-elevated) text-(--t-text-dim)`}>{count}</span>
      )}
      {(aside || onToggle) && (
        <span className="ml-auto flex items-center gap-2">
          {aside}
          {onToggle && <Icon icon={collapsed ? "lucide:chevron-right" : "lucide:chevron-down"} width={11} className="text-(--t-text-dim)" />}
        </span>
      )}
    </>
  );
  const layout = `w-full flex items-center gap-2 ${className ?? (compact ? "px-3 py-1.5" : "mb-3")}`;
  return onToggle
    ? <button type="button" className={`${layout} text-left cursor-pointer`} onClick={onToggle}>{body}</button>
    : <div className={layout}>{body}</div>;
}

export function SectionAddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="flex items-center gap-1 text-xs transition-colors px-2 py-1 rounded-lg text-(--t-text-dim) hover:text-(--t-text-primary) hover:bg-(--t-bg-elevated)"
      onClick={onClick}
    >
      <Icon icon="lucide:plus" width={12} />
      {label}
    </button>
  );
}

const PILL_TONES = {
  connected: "bg-(--t-status-connected)/10 text-(--t-status-connected)",
  error: "bg-(--t-status-error)/10 text-(--t-status-error)",
};

export function StatusPill({ tone, children }: { tone: keyof typeof PILL_TONES; children: ReactNode }) {
  return <span className={`px-1.5 py-0.5 rounded-full text-[10px] leading-none ${PILL_TONES[tone]}`}>{children}</span>;
}
