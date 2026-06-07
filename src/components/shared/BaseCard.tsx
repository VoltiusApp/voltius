import { memo } from "react";
import { ContextMenu, useContextMenu, type ContextMenuItem } from "@/components/shared/ContextMenu";

interface BaseCardProps {
  isSelected?: boolean;
  isEditing?: boolean;
  isActive?: boolean;
  isFocused?: boolean;
  isList?: boolean;
  glass?: boolean;
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

const GLASS_BG = "linear-gradient(140deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.02) 45%, transparent 100%), color-mix(in srgb, var(--t-bg-card) 68%, transparent)";
const GLASS_BG_HOVER = "linear-gradient(140deg, rgba(255,255,255,0.11) 0%, rgba(255,255,255,0.03) 45%, transparent 100%), color-mix(in srgb, var(--t-bg-card) 80%, transparent)";
const GLASS_SHADOW = "0 0 0 1px rgba(255,255,255,0.09), 0 6px 20px -6px rgba(0,0,0,0.55), inset 0 1.5px 0 rgba(255,255,255,0.18), inset 0 -1px 0 rgba(0,0,0,0.12)";
const GLASS_SHADOW_HOVER = "0 0 0 1px rgba(255,255,255,0.13), 0 10px 28px -6px rgba(0,0,0,0.65), inset 0 1.5px 0 rgba(255,255,255,0.24), inset 0 -1px 0 rgba(0,0,0,0.15)";

export const BaseCard = memo(function BaseCard({
  isSelected,
  isEditing,
  isActive,
  isFocused,
  isList,
  glass,
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

  const glassStyle: React.CSSProperties = glass ? {
    background: GLASS_BG,
    backdropFilter: "blur(12px) saturate(1.5)",
    WebkitBackdropFilter: "blur(12px) saturate(1.5)",
    boxShadow: GLASS_SHADOW,
    border: "2px solid transparent",
  } : { border: "2px solid transparent" };

  return (
    <>
      <div
        data-card={dataCard}
        data-host-card={dataHostCard}
        data-connection-id={dataConnectionId}
        data-selectable-id={dataSelectableId}
        className={`group relative flex items-center px-3 cursor-pointer transition-all duration-150 ${glass ? "" : "bg-(--t-bg-card)"} ${isList ? "gap-2.5 py-2.5 rounded-xl" : "gap-4 py-3 rounded-2xl"} ${className}`}
        style={{ ...glassStyle, ...style }}
        onPointerDown={onPointerDown}
        onClick={onClick ? (e) => { e.stopPropagation(); onClick(e); } : undefined}
        onDoubleClick={onDoubleClick}
        onContextMenu={activeMenuItems?.length ? (e) => { e.stopPropagation(); open(e); if (!isSelected) onClick?.(e); } : undefined}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = glass ? GLASS_BG_HOVER : "var(--t-bg-card-hover)";
          if (!isActive && !isSelected && !isEditing && !isFocused) {
            e.currentTarget.style.boxShadow = glass ? GLASS_SHADOW_HOVER : "inset 0 0 0 1px var(--t-card-ring), var(--t-card-shadow)";
          }
          onMouseEnter?.();
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = glass ? GLASS_BG : "var(--t-bg-card)";
          e.currentTarget.style.boxShadow = glass ? GLASS_SHADOW : "none";
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
