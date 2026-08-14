import { useEffect } from "react";
import i18n from "@/i18n";
import { shouldSuppressDragClick, useDragStore } from "@/stores/dragStore";
import { findLeafBySession, useLayoutStore } from "@/stores/layoutStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useSessionStore } from "@/stores/sessionStore";
import { duplicateSession } from "@/services/duplicateSession";

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

    const onUp = (e: MouseEvent | PointerEvent) => {
      const drag = useDragStore.getState();
      const layout = useLayoutStore.getState();
      if (drag.isDragging && drag.dropTarget) {
        // Ctrl+drag a tab onto a drop zone duplicates the session instead of moving it.
        if (drag.dragType === "tab" && e.ctrlKey && drag.sessionId && drag.dropTarget.type !== "titlebar") {
          const anchor = drag.dropTarget.type === "pane"
            ? { paneId: drag.dropTarget.paneId }
            : { sessionId: drag.dropTarget.sessionId };
          const duplicated = duplicateSession(drag.sessionId, drag.dropTarget.position, anchor);
          if (!duplicated) {
            useNotificationStore.getState().addToast({
              source: { kind: "plugin", id: "core", name: "Voltius" },
              type: "toast",
              message: i18n.t("panes.dragToast.cannotDuplicate"),
              severity: "info",
              duration: 2500,
            });
          }
          useDragStore.getState().endDrag();
          return;
        }
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
              source: { kind: "plugin", id: "core", name: "Voltius" },
              type: "toast",
              message: i18n.t("panes.dragToast.alreadyVisible"),
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
              source: { kind: "plugin", id: "core", name: "Voltius" },
              type: "toast",
              message: i18n.t("panes.dragToast.invalidDropTarget"),
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

    // A lost mouseup used to strand isPointerDown, killing every later click.
    const onAbort = () => useDragStore.getState().cancelDrag();

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onAbort);
    window.addEventListener("blur", onAbort);
    document.addEventListener("mouseleave", onAbort);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onAbort);
      window.removeEventListener("blur", onAbort);
      document.removeEventListener("mouseleave", onAbort);
      window.removeEventListener("keydown", onKeyDown);
      body.style.userSelect = prevUserSelect;
      body.style.webkitUserSelect = prevWebkitUserSelect;
    };
  }, [isPointerDown]);
}

export { shouldSuppressDragClick };
