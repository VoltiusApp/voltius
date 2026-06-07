import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { useMoveDragState, useSemanticDragState } from "./internalDrag";

export function InternalDragGhost() {
  const semantic = useSemanticDragState();
  const move = useMoveDragState();
  // OS-originated drags supply their own cursor visualization, so we suppress
  // ours to avoid double ghosts.
  if (!semantic || semantic.side === "external") return null;

  const count = semantic.files.length;
  const hasDir = semantic.files.some((f) => f.isDir);
  const single = count === 1 ? semantic.files[0] : null;
  const label = single ? single.name : `${count} items`;
  const iconName = single
    ? (single.isDir ? "lucide:folder" : "lucide:file")
    : (hasDir ? "lucide:folder" : "lucide:file");
  const iconColor = (single?.isDir ?? hasDir) ? "#f0c050" : "var(--t-text-dim)";

  return createPortal(
    <div
      style={{
        position: "fixed",
        left: move.x + 12,
        top: move.y + 12,
        pointerEvents: "none",
        zIndex: 9999,
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        borderRadius: 8,
        background: "var(--t-bg-card)",
        border: "1px solid var(--t-accent)",
        color: "var(--t-text-primary)",
        fontSize: 12,
        fontFamily: "inherit",
        whiteSpace: "nowrap",
        boxShadow: "var(--t-elev-2)",
      }}
    >
      <Icon icon={iconName} width={14} style={{ color: iconColor }} />
      <span>{label}</span>
      {count > 1 && (
        <span
          style={{
            background: "var(--t-accent)",
            color: "#fff",
            borderRadius: 9999,
            padding: "0 6px",
            fontSize: 11,
            fontWeight: 600,
            lineHeight: "18px",
          }}
        >
          {count}
        </span>
      )}
    </div>,
    document.body,
  );
}
