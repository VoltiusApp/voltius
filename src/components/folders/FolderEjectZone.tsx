import { Icon } from "@iconify/react";

/**
 * Drop target for taking an item out of the folder being viewed. It occupies no
 * space until a drag starts, so it cannot push the list around at rest.
 */
export function FolderEjectZone({ label, isDragging, dragOver, dropProps }: {
  label: string;
  isDragging: boolean;
  dragOver: boolean;
  dropProps: { "data-drop-eject": string };
}) {
  return (
    <div
      className="flex items-center gap-3 px-4 py-3 rounded-2xl transition-all duration-150"
      style={{
        border: dragOver ? "2px solid var(--t-accent)" : "2px dashed var(--t-border-hover)",
        background: dragOver ? "color-mix(in srgb, var(--t-accent) 8%, var(--t-bg-card))" : "transparent",
        color: dragOver ? "var(--t-accent)" : "var(--t-text-dim)",
        opacity: isDragging ? 1 : 0,
        pointerEvents: isDragging ? "auto" : "none",
        height: isDragging ? undefined : 0,
        padding: isDragging ? undefined : 0,
        marginTop: isDragging ? undefined : 0,
        overflow: "hidden",
      }}
      {...dropProps}
    >
      <Icon icon="lucide:folder-minus" width={16} />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}
