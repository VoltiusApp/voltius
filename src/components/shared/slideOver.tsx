import type { ReactNode } from "react";
import { Icon } from "@iconify/react";

export function SlideOverHeader({ icon, title, onBack }: { icon: string; title: string; onBack: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-3 shrink-0 border-b border-b-(--t-bg-terminal)">
      <button
        onClick={onBack}
        className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors text-(--t-text-dim) hover:text-(--t-text-primary) hover:bg-(--t-bg-elevated)"
      >
        <span className="[&_path]:stroke-3">
          <Icon icon="lucide:arrow-left" width={16} />
        </span>
      </button>
      <Icon icon={icon} width={14} className="text-(--t-text-dim)" />
      <h2 className="text-sm font-semibold flex-1 text-(--t-text-primary)">{title}</h2>
    </div>
  );
}

export function DashedAddButton({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed border-(--t-border) text-xs text-(--t-text-dim) hover:text-(--t-text-primary) hover:border-(--t-border-hover) transition-colors"
    >
      <Icon icon="lucide:plus" width={13} />
      {children}
    </button>
  );
}

export function SlideOver({ open, className = "", children }: { open: boolean; className?: string; children: ReactNode }) {
  return (
    <div
      className={`absolute inset-0 transition-transform duration-200 ease-out ${className}`}
      style={{ transform: open ? "translateX(0)" : "translateX(100%)" }}
    >
      {children}
    </div>
  );
}
