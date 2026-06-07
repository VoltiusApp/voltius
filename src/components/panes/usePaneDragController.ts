import { useEffect } from "react";
import { shouldSuppressDragClick, useDragStore } from "@/stores/dragStore";
import { findLeafBySession, useLayoutStore } from "@/stores/layoutStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useSessionStore } from "@/stores/sessionStore";

export function usePaneDragController() {
  const isPointerDown = useDragStore((s) => s.isPointerDown);

  useEffect(() => {
    if (!isPointerDown) return;

    // Suppress native text selection for the whole drag gesture — without this
    // the cursor sweeping the pane header title or the minimap gutter selects
    // their text. Cleared on drag end via the cleanup below.
    const body = document.body;
    const prevUserSelect = body.style.userSelect;
    const prevWebkitUserSelect = body.style.webkitUserSelect;
    body.style.userSelect = "none";
    body.style.webkitUserSelect = "none";
    window.getSelection()?.removeAllRanges();

    const onMove = (e: MouseEvent) => {
      useDragStore.getState().updatePointer(e.clientX, e.clientY);
    };

    const onUp = () => {
      const drag = useDragStore.getState();
      const layout = useLayoutStore.getState();
      if (drag.isDragging && drag.dropTarget) {
        if (drag.dragType === "tab") {
          if (drag.sourceTitlebarKey && drag.dropTarget.type === "titlebar") {
            layout.reorderTitlebarItem(drag.sourceTitlebarKey, drag.dropTarget.targetKey ?? null, drag.dropTarget.placement ?? "after");
            useDragStore.getState().endDrag();
            return;
          }
          if (!drag.sessionId) {
            useDragStore.getState().endDrag();
            return;
          }

          const existing = findLeafBySession(layout.root, drag.sessionId);
          if (existing) {
            layout.setActivePane(existing.id);
            useSessionStore.getState().setActive(drag.sessionId);
            useNotificationStore.getState().addToast({
              pluginId: "core",
              pluginName: "Voltius",
              type: "toast",
              message: "That session is already visible in the split workspace.",
              severity: "info",
              duration: 2500,
            });
          } else if (drag.dropTarget.type === "session" && drag.dropTarget.sessionId) {
            layout.createSplitTab(drag.dropTarget.sessionId, drag.sessionId, drag.dropTarget.position);
            useSessionStore.getState().setActive(drag.sessionId);
          } else if (drag.dropTarget.type === "pane" && drag.dropTarget.paneId) {
            layout.splitPane(drag.dropTarget.paneId, drag.sessionId, drag.dropTarget.position);
            useSessionStore.getState().setActive(drag.sessionId);
          } else {
            useNotificationStore.getState().addToast({
              pluginId: "core",
              pluginName: "Voltius",
              type: "toast",
              message: "Drop onto the active terminal or a split pane to create a split.",
              severity: "info",
              duration: 2500,
            });
          }
        } else if (drag.dragType === "pane" && drag.sourcePaneId && drag.dropTarget.type === "titlebar") {
          const detachedSessionId = layout.detachPane(drag.sourcePaneId);
          if (detachedSessionId) {
            layout.placeTitlebarItem(`session:${detachedSessionId}`, drag.dropTarget.targetKey ?? null, drag.dropTarget.placement ?? "after");
            useSessionStore.getState().setActive(detachedSessionId);
          }
        } else if (drag.dragType === "pane" && drag.sourcePaneId && drag.dropTarget.type === "pane" && drag.dropTarget.paneId) {
          layout.movePane(drag.sourcePaneId, drag.dropTarget.paneId, drag.dropTarget.position);
          if (drag.sessionId) useSessionStore.getState().setActive(drag.sessionId);
        }
      }
      useDragStore.getState().endDrag();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") useDragStore.getState().cancelDrag();
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKeyDown);
      body.style.userSelect = prevUserSelect;
      body.style.webkitUserSelect = prevWebkitUserSelect;
    };
  }, [isPointerDown]);
}

export { shouldSuppressDragClick };
