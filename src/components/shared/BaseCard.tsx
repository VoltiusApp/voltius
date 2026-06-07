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
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
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
  onPointerDown,
  onMouseEnter,
  onMouseLeave,
  "data-card": dataCard,
  "data-host-card": dataHostCard,
  "data-connection-id": dataConnectionId,
  "data-selectable-id": dataSelectableId,
}: BaseCardProps) {
  const { pos, open, close } = useContextMenu();
  const activeMenuItems = isSelected && bulkContextMenuItems?.length ? bulkContextMenuItems : contextMenuItems;

  const activeBorderColor = isEditing || isSelected ? "var(--t-accent)" : "transparent";
  const focusBoxShadow = isFocused && !isSelected && !isEditing ? "inset 0 0 0 2px var(--t-accent)" : "none";
  const showOverlay = isEditing || isSelected || isFocused;

  return (
    <>
      <div
        data-card={dataCard}
        data-host-card={dataHostCard}
        data-connection-id={dataConnectionId}
        data-selectable-id={dataSelectableId}
        className={`group relative flex items-center px-3 cursor-pointer transition-all duration-150 bg-(--t-bg-card) ${isList ? "gap-2.5 py-2.5 rounded-xl" : "gap-4 py-3 rounded-2xl"} ${className}`}
        style={{ border: "2px solid transparent", ...style }}
        onPointerDown={onPointerDown}
        onClick={onClick ? (e) => { e.stopPropagation(); onClick(e); } : undefined}
        onDoubleClick={onDoubleClick}
        onContextMenu={activeMenuItems?.length ? (e) => { e.stopPropagation(); open(e); if (!isSelected) onClick?.(e); } : undefined}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "var(--t-bg-card-hover)";
          if (!isActive && !isSelected && !isEditing && !isFocused) {
            e.currentTarget.style.boxShadow = "inset 0 0 0 1px var(--t-card-ring), var(--t-card-shadow)";
          }
          onMouseEnter?.();
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "var(--t-bg-card)";
          e.currentTarget.style.boxShadow = "none";
          onMouseLeave?.();
        }}
      >
        {children}
        {showOverlay && (
          <div
            className="absolute inset-[-2px] rounded-2xl border-2 pointer-events-none"
            style={{ borderColor: activeBorderColor, boxShadow: focusBoxShadow }}
          />
        )}
      </div>

      {pos && !!activeMenuItems?.length && (
        <ContextMenu items={activeMenuItems} pos={pos} onClose={close} />
      )}
    </>
  );
});
