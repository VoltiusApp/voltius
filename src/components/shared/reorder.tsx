import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import type { useListReorder } from "@/hooks/useListReorder";

type Reorder = ReturnType<typeof useListReorder<{ id: string }>>;

export function ReorderHandle({ handleProps, label }: { handleProps: ReturnType<Reorder["handleProps"]>; label: string }) {
  return (
    <div
      {...handleProps}
      className="text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors shrink-0 cursor-grab active:cursor-grabbing"
      aria-label={label}
    >
      <Icon icon="lucide:grip-vertical" width={14} />
    </div>
  );
}

export function OrderBadge({ n }: { n: number }) {
  return (
    <span className="w-5 h-5 rounded-full bg-(--t-accent) text-(--t-bg-card) text-[10px] font-bold flex items-center justify-center shrink-0">
      {n}
    </span>
  );
}

export function ReorderableRow({ dnd, id, index, onRemove, removeLabel, dragLabel, children }: {
  dnd: Reorder; id: string; index: number; onRemove: () => void; removeLabel: string; dragLabel: string; children: ReactNode;
}) {
  return (
    <div
      {...dnd.rowProps(id)}
      style={dnd.rowStyle(id)}
      className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg bg-(--t-bg-elevated) border border-(--t-border) transition-colors"
    >
      <ReorderHandle handleProps={dnd.handleProps(id)} label={dragLabel} />
      <OrderBadge n={index + 1} />
      {children}
      <button
        type="button"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={onRemove}
        className="text-(--t-text-dim) hover:text-red-400 transition-colors shrink-0"
        aria-label={removeLabel}
      >
        <Icon icon="lucide:x" width={14} />
      </button>
    </div>
  );
}
