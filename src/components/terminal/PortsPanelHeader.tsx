import { Icon } from "@iconify/react";

export function PortsPanelHeader({
  activeCount,
  onAdd,
}: {
  activeCount: number;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-(--t-border) shrink-0">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-sm font-medium text-(--t-text-bright)">Ports</span>
        {activeCount > 0 && (
          <span className="text-xs text-(--t-text-muted)">{activeCount} active</span>
        )}
      </div>
      <button
        onClick={onAdd}
        title="Forward a port"
        className="w-6 h-6 flex items-center justify-center rounded transition-colors
          text-(--t-text-muted) hover:text-(--t-text-primary) hover:bg-(--t-bg-elevated)"
      >
        <Icon icon="lucide:plus" width={15} />
      </button>
    </div>
  );
}
