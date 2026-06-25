import { useEditorStore } from "@/stores/editorStore";
import { useTabDragSemantic } from "./tabDrag";

// Left/right drop overlay shown over the active editor content while a file tab
// is being dragged. Modeled on the terminal DropZones. It carries
// `data-editor-drop-area` so tabDrag's elementFromPoint hit-test lands on it,
// and covers CodeMirror (pointer-events) to suppress text selection mid-drag.
export function EditorDropOverlay() {
  const drag = useTabDragSemantic();
  const activeTabId = useEditorStore((s) => s.activeTabId);

  if (!drag || activeTabId === null) return null;

  const side = drag.target?.kind === "editorDiff" ? drag.target.side : null;
  const fill = "color-mix(in srgb, var(--t-accent) 30%, transparent)";

  return (
    <div data-editor-drop-area className="absolute inset-0 z-20">
      <div
        className="absolute left-0 top-0 bottom-0 w-1/2 transition-opacity duration-150 ease-out"
        style={{ background: fill, opacity: side === "left" ? 1 : 0 }}
      />
      <div
        className="absolute right-0 top-0 bottom-0 w-1/2 transition-opacity duration-150 ease-out"
        style={{ background: fill, opacity: side === "right" ? 1 : 0 }}
      />
    </div>
  );
}
