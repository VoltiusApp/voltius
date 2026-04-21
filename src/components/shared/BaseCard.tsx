import { memo } from "react";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";

interface BaseCardProps {
  isSelected?: boolean;
  isEditing?: boolean;
  isActive?: boolean;
  isFocused?: boolean;
  isList?: boolean;
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  onDoubleClick?: () => void;
  contextMenuItems?: ContextMenuItem[];
  /** Shown instead of contextMenuItems when the card is selected and multiple items are selected */
  bulkContextMenuItems?: ContextMenuItem[];
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
  "data-card"?: boolean | string;
  "data-host-card"?: string;
  "data-connection-id"?: string;
  "data-selectable-id"?: string;
}

export const BaseCard = memo(function BaseCard({
  isSelected,
  isEditing,
  isActive,
  isFocused,
  isList,
  onClick,
  onDoubleClick,
  contextMenuItems,
  bulkContextMenuItems,
  children,
  className = "",
  style,
  draggable,
  onDragStart,
  onDragEnd,
  "data-card": dataCard,
  "data-host-card": dataHostCard,
  "data-connection-id": dataConnectionId,
  "data-selectable-id": dataSelectableId,
}: BaseCardProps) {
  const { pos, open, close } = useContextMenu();
  const activeMenuItems = isSelected && bulkContextMenuItems?.length ? bulkContextMenuItems : contextMenuItems;

  const activeBorderColor = isEditing
    ? "var(--t-accent)"
    : isSelected
    ? "var(--t-tab-active-text)"
    : isActive
    ? "var(--t-status-connected)"
    : "transparent";

  const focusBoxShadow = isFocused && !isSelected && !isEditing
    ? "inset 0 0 0 2px var(--t-accent)"
    : "none";

  return (
    <>
      <div
        data-card={dataCard}
        data-host-card={dataHostCard}
        data-connection-id={dataConnectionId}
        data-selectable-id={dataSelectableId}
        className={`group flex items-center px-4 rounded-2xl cursor-pointer transition-all duration-150 bg-[var(--t-bg-card)] ${isList ? "gap-3 py-2" : "gap-4 py-4"} ${className}`}
        style={{ border: `2px solid ${activeBorderColor}`, boxShadow: focusBoxShadow, ...style }}
        draggable={draggable}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onClick={onClick ? (e) => { e.stopPropagation(); onClick(e); } : undefined}
        onDoubleClick={onDoubleClick}
        onContextMenu={activeMenuItems?.length ? (e) => { e.stopPropagation(); open(e); if (!isSelected) onClick?.(e); } : undefined}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--t-bg-card-hover)";
          if (!isActive && !isSelected && !isEditing) e.currentTarget.style.borderColor = "var(--t-border-hover)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--t-bg-card)";
          e.currentTarget.style.borderColor = activeBorderColor;
        }}
      >
        {children}
      </div>

      {pos && !!activeMenuItems?.length && (
        <ContextMenu items={activeMenuItems} pos={pos} onClose={close} />
      )}
    </>
  );
});
