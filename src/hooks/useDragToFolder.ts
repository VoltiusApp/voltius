import { useEffect, useRef, useState } from "react";

// HTML5 drag-and-drop is unreliable inside the Tauri WebView2 on Windows when
// `dragDropEnabled: true` is set in tauri.conf.json — Tauri's OLE drop target
// intercepts in-webview drags and shows the "not allowed" cursor. We need
// dragDropEnabled for SFTP OS file-drop, so we re-implement card drag-to-folder
// on top of pointer events. Drop targets are marked with `data-drop-folder`
// and `data-drop-eject` attributes and discovered via elementFromPoint hit
// testing on pointermove / pointerup.

const DRAG_THRESHOLD_PX = 5;

interface UseDragToFolderOptions {
  /** Currently selected item IDs — used to expand single-item drag to multi-select. */
  selectedIdSet: Set<string>;
  /** Folder IDs visible in the current view — excluded from item drag payload. */
  folderIds: Set<string>;
  /** Called when items are dropped onto a folder. */
  onDropToFolder: (ids: string[], folderId: string) => Promise<void>;
  /** Called when items are dropped onto the eject zone. `targetFolderId` is null when ejecting to root. */
  onEject: (ids: string[], targetFolderId: string | null) => Promise<void>;
  /** Called when folders are dropped onto another folder. Optional — enables folder-as-drag-source. */
  onMoveFolders?: (folderIds: string[], targetParentId: string) => Promise<void>;
  /** Called when folders are dropped onto the eject zone. Optional — pairs with onMoveFolders. */
  onEjectFolders?: (folderIds: string[], targetParentId: string | null) => Promise<void>;
}

interface UseDragToFolderResult {
  isDragging: boolean;
  dragOverFolderId: string | null;
  dragOverEject: boolean;
  /** Wire to a card's `onPointerDown` — starts a drag once the pointer moves past the threshold. */
  handleDragStart: (e: React.PointerEvent, itemId: string) => void;
  /** Wire to a folder card's `onPointerDown` — drag the folder itself. */
  handleFolderDragStart: (e: React.PointerEvent, folderId: string) => void;
  /** Kept for source compat; the hook now ends drags via window pointerup so this is a no-op. */
  handleDragEnd: () => void;
  folderDropProps: (folderId: string) => { "data-drop-folder": string };
  ejectDropProps: (targetFolderId: string | null) => { "data-drop-eject": string };
}

interface PendingDrag {
  kind: "item" | "folder";
  id: string;
  startX: number;
  startY: number;
  el: HTMLElement;
  offsetX: number;
  offsetY: number;
}

function findDropTargets(x: number, y: number): { folder: HTMLElement | null; eject: HTMLElement | null } {
  const el = document.elementFromPoint(x, y);
  let folder: HTMLElement | null = null;
  let eject: HTMLElement | null = null;
  let cur: HTMLElement | null = el as HTMLElement | null;
  while (cur && (!folder || !eject)) {
    if (!folder && cur.hasAttribute("data-drop-folder")) folder = cur;
    if (!eject && cur.hasAttribute("data-drop-eject")) eject = cur;
    cur = cur.parentElement;
  }
  return { folder, eject };
}

export function useDragToFolder({
  selectedIdSet,
  folderIds,
  onDropToFolder,
  onEject,
  onMoveFolders,
  onEjectFolders,
}: UseDragToFolderOptions): UseDragToFolderResult {
  const pendingRef = useRef<PendingDrag | null>(null);
  const draggingItemIdsRef = useRef<string[]>([]);
  const draggingFolderIdsRef = useRef<string[]>([]);
  const ghostRef = useRef<HTMLElement | null>(null);
  const isDraggingRef = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null);
  const [dragOverEject, setDragOverEject] = useState(false);

  // Keep latest options accessible from window handlers without re-binding listeners.
  const optsRef = useRef({ selectedIdSet, folderIds, onDropToFolder, onEject, onMoveFolders, onEjectFolders });
  optsRef.current = { selectedIdSet, folderIds, onDropToFolder, onEject, onMoveFolders, onEjectFolders };

  useEffect(() => {
    function cleanup() {
      pendingRef.current = null;
      draggingItemIdsRef.current = [];
      draggingFolderIdsRef.current = [];
      if (ghostRef.current) { ghostRef.current.remove(); ghostRef.current = null; }
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      isDraggingRef.current = false;
      setIsDragging(false);
      setDragOverFolderId(null);
      setDragOverEject(false);
    }

    function buildStackedGhost(
      title: string,
      subtitle: string | null,
      count: number,
      kind: "item" | "folder",
      avatar: HTMLElement | null,
    ): HTMLElement {
      const wrapper = document.createElement("div");
      wrapper.style.cssText = [
        "position:fixed",
        "left:0", "top:0",
        "pointer-events:none",
        "z-index:9999",
      ].join(";");

      const stack = Math.min(count, 3);
      // Background cards offset up-right behind the foreground card to suggest a stack.
      for (let i = 1; i < stack; i++) {
        const back = document.createElement("div");
        back.style.cssText = [
          "position:absolute",
          `top:${-i * 4}px`,
          `left:${i * 5}px`,
          "right:0",
          "height:100%",
          "border-radius:10px",
          "background:var(--t-bg-card)",
          "border:1px solid var(--t-border)",
          "box-shadow:0 4px 14px rgba(0,0,0,0.28)",
          `opacity:${(1 - i * 0.22).toFixed(2)}`,
          `z-index:${stack - i}`,
        ].join(";");
        wrapper.appendChild(back);
      }

      const card = document.createElement("div");
      card.style.cssText = [
        "position:relative",
        "display:flex",
        "align-items:center",
        "gap:10px",
        "padding:8px 10px",
        "border-radius:10px",
        "background:var(--t-bg-card)",
        "border:1px solid var(--t-accent)",
        "box-shadow:0 8px 22px rgba(0,0,0,0.4)",
        "min-width:180px",
        "max-width:240px",
        "box-sizing:border-box",
        `z-index:${stack}`,
      ].join(";");

      if (avatar) {
        // Strip any inherited transforms / animations and force a compact size.
        avatar.style.transition = "none";
        avatar.style.animation = "none";
        avatar.style.width = "26px";
        avatar.style.height = "26px";
        avatar.style.flexShrink = "0";
        avatar.querySelectorAll<HTMLElement>("*").forEach((node) => {
          node.style.transition = "none";
          node.style.animation = "none";
        });
        avatar.querySelectorAll("svg").forEach((svg) => {
          svg.setAttribute("width", "14");
          svg.setAttribute("height", "14");
        });
        card.appendChild(avatar);
      } else {
        const icon = document.createElement("div");
        icon.style.cssText = [
          "width:26px", "height:26px",
          "border-radius:6px",
          kind === "folder"
            ? "background:color-mix(in srgb, var(--t-accent) 35%, transparent)"
            : "background:var(--t-bg-card-avatar)",
          "flex-shrink:0",
        ].join(";");
        card.appendChild(icon);
      }

      const textCol = document.createElement("div");
      textCol.style.cssText = "display:flex;flex-direction:column;gap:1px;min-width:0;flex:1;";

      const titleEl = document.createElement("span");
      titleEl.style.cssText = "font-size:13px;font-weight:600;color:var(--t-text-bright);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;";
      titleEl.textContent = title;
      textCol.appendChild(titleEl);

      if (subtitle) {
        const subEl = document.createElement("span");
        subEl.style.cssText = "font-size:11px;color:var(--t-text-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.2;";
        subEl.textContent = subtitle;
        textCol.appendChild(subEl);
      }
      card.appendChild(textCol);

      if (count > 1) {
        const badge = document.createElement("span");
        badge.style.cssText = [
          "background:var(--t-accent)",
          "color:#fff",
          "border-radius:9999px",
          "min-width:20px",
          "height:20px",
          "padding:0 6px",
          "display:flex",
          "align-items:center",
          "justify-content:center",
          "font-size:11px",
          "font-weight:700",
          "flex-shrink:0",
        ].join(";");
        badge.textContent = `+${count - 1}`;
        card.appendChild(badge);
      }

      wrapper.appendChild(card);
      return wrapper;
    }

    function readSourceText(el: HTMLElement): { title: string; subtitle: string | null } {
      const ps = el.querySelectorAll("p, span[data-card-title]");
      const title = (ps[0]?.textContent ?? "").trim();
      const sub = (ps[1]?.textContent ?? "").trim();
      return { title: title || "Item", subtitle: sub || null };
    }

    function readSourceAvatar(el: HTMLElement): HTMLElement | null {
      // The first svg inside the card belongs to the card's avatar/icon block.
      // Clone its containing element so we get the colored background pill plus icon.
      const svg = el.querySelector("svg");
      if (!svg) return null;
      const parent = svg.parentElement;
      if (!parent) return null;
      return parent.cloneNode(true) as HTMLElement;
    }

    function beginActiveDrag(x: number, y: number) {
      const p = pendingRef.current;
      if (!p) return;

      let count = 1;
      if (p.kind === "item") {
        const ids = (optsRef.current.selectedIdSet.has(p.id)
          ? [...optsRef.current.selectedIdSet]
          : [p.id]
        ).filter((id) => !optsRef.current.folderIds.has(id));
        if (ids.length === 0) { pendingRef.current = null; return; }
        draggingItemIdsRef.current = ids;
        count = ids.length;
      } else {
        draggingFolderIdsRef.current = [p.id];
      }

      const { title, subtitle } = readSourceText(p.el);
      const avatar = readSourceAvatar(p.el);
      const ghost = buildStackedGhost(title, subtitle, count, p.kind, avatar);
      // Offset slightly down-right of the cursor.
      ghost.style.transform = `translate(${x + 12}px, ${y + 12}px)`;
      document.body.appendChild(ghost);
      ghostRef.current = ghost;

      document.body.style.cursor = "grabbing";
      document.body.style.userSelect = "none";

      isDraggingRef.current = true;
      setIsDragging(true);
    }

    function applyHover(x: number, y: number) {
      if (ghostRef.current) ghostRef.current.style.visibility = "hidden";
      const { folder, eject } = findDropTargets(x, y);
      if (ghostRef.current) ghostRef.current.style.visibility = "";

      if (folder) {
        const folderId = folder.getAttribute("data-drop-folder")!;
        const hasItems = draggingItemIdsRef.current.length > 0;
        const hasFolders = draggingFolderIdsRef.current.length > 0
          && !draggingFolderIdsRef.current.includes(folderId);
        if (hasItems || hasFolders) {
          setDragOverFolderId(folderId);
          setDragOverEject(false);
          return;
        }
      }
      if (eject) {
        setDragOverFolderId(null);
        setDragOverEject(true);
        return;
      }
      setDragOverFolderId(null);
      setDragOverEject(false);
    }

    function onPointerMove(e: PointerEvent) {
      const p = pendingRef.current;
      if (!p) return;

      if (!isDraggingRef.current) {
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < DRAG_THRESHOLD_PX) return;
        beginActiveDrag(e.clientX, e.clientY);
      }

      if (ghostRef.current) {
        ghostRef.current.style.transform = `translate(${e.clientX + 12}px, ${e.clientY + 12}px)`;
      }
      applyHover(e.clientX, e.clientY);
    }

    function onPointerUp(e: PointerEvent) {
      const p = pendingRef.current;
      if (!p) return;
      if (!isDraggingRef.current) { pendingRef.current = null; return; }

      if (ghostRef.current) ghostRef.current.style.visibility = "hidden";
      const { folder, eject } = findDropTargets(e.clientX, e.clientY);

      const folderDragIds = [...draggingFolderIdsRef.current];
      const itemIds = [...draggingItemIdsRef.current];
      cleanup();

      if (folder) {
        const folderId = folder.getAttribute("data-drop-folder")!;
        if (folderDragIds.length > 0 && !folderDragIds.includes(folderId)) {
          void optsRef.current.onMoveFolders?.(folderDragIds, folderId);
        } else if (itemIds.length > 0) {
          void optsRef.current.onDropToFolder(itemIds, folderId);
        }
      } else if (eject) {
        const raw = eject.getAttribute("data-drop-eject");
        const targetFolderId = raw && raw.length > 0 ? raw : null;
        if (folderDragIds.length > 0) {
          void optsRef.current.onEjectFolders?.(folderDragIds, targetFolderId);
        } else if (itemIds.length > 0) {
          void optsRef.current.onEject(itemIds, targetFolderId);
        }
      }

      // Swallow the synthetic click that follows pointerup so the card's
      // onClick (selection toggle) doesn't fire as part of the drag gesture.
      const suppress = (ev: MouseEvent) => {
        ev.preventDefault();
        ev.stopPropagation();
        window.removeEventListener("click", suppress, true);
      };
      window.addEventListener("click", suppress, true);
      setTimeout(() => window.removeEventListener("click", suppress, true), 50);
    }

    function onPointerCancel() { if (pendingRef.current) cleanup(); }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, []);

  const handleDragStart = (e: React.PointerEvent, itemId: string) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    pendingRef.current = {
      kind: "item",
      id: itemId,
      startX: e.clientX,
      startY: e.clientY,
      el,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
  };

  const handleFolderDragStart = (e: React.PointerEvent, folderId: string) => {
    if (e.button !== 0) return;
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    pendingRef.current = {
      kind: "folder",
      id: folderId,
      startX: e.clientX,
      startY: e.clientY,
      el,
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    e.stopPropagation();
  };

  const handleDragEnd = () => {};

  const folderDropProps = (folderId: string) => ({ "data-drop-folder": folderId });
  const ejectDropProps = (targetFolderId: string | null) => ({ "data-drop-eject": targetFolderId ?? "" });

  return {
    isDragging,
    dragOverFolderId,
    dragOverEject,
    handleDragStart,
    handleFolderDragStart,
    handleDragEnd,
    folderDropProps,
    ejectDropProps,
  };
}
