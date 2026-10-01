import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { useUIStore } from "@/stores/uiStore";

export interface ContextMenuItem {
  label: string;
  icon?: string;
  /** Required when no children. Ignored when children are present. */
  onClick?: () => void;
  danger?: boolean;
  /** Renders a thin divider line above this item */
  divider?: boolean;
  /** Submenu items — renders a chevron-right and opens on hover */
  children?: ContextMenuItem[];
  /** Keyboard shortcut hint displayed on the right (e.g. "Delete", "Ctrl+K") */
  shortcut?: string;
  /** Dim text after the label, e.g. "yours" */
  hint?: string;
}

// ── Shared item-list renderer (no positioning) ────────────────────────────────

export function MenuItemList({
  items,
  onClose,
  onMouseEnter,
  onMouseLeave,
}: {
  items: ContextMenuItem[];
  onClose: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}) {
  const [activeSub, setActiveSub] = useState<{ idx: number; x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  };

  const scheduleClose = () => {
    clearTimer();
    timerRef.current = setTimeout(() => setActiveSub(null), 120);
  };

  const openSub = (idx: number, rowEl: HTMLButtonElement) => {
    clearTimer();
    const rect = rowEl.getBoundingClientRect();
    const subWidth = 192;
    const flipLeft = rect.right + subWidth > window.innerWidth;
    setActiveSub({
      idx,
      x: flipLeft ? rect.left - subWidth - 4 : rect.right + 4,
      y: rect.top,
    });
  };

  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
      {items.map((item, i) => {
        const isSubActive = activeSub?.idx === i;
        return (
          <div key={i}>
            {item.divider && i > 0 && (
              <div className="my-1 mx-1 h-px bg-(--t-border)" />
            )}
            <button
              onClick={item.children ? undefined : () => { item.onClick?.(); onClose(); }}
              className="flex items-center gap-2.5 p-3 rounded-lg transition-colors w-full"
              style={{
                background: isSubActive ? "var(--t-bg-card-hover)" : "transparent",
                color: item.danger ? "var(--t-status-error)" : "var(--t-text-secondary)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "var(--t-bg-card-hover)";
                if (!item.danger) e.currentTarget.style.color = "var(--t-text-primary)";
                if (item.children) openSub(i, e.currentTarget);
                else scheduleClose();
              }}
              onMouseLeave={(e) => {
                if (!isSubActive) e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = item.danger ? "var(--t-status-error)" : "var(--t-text-secondary)";
                if (item.children) scheduleClose();
              }}
            >
              {item.icon && <Icon icon={item.icon} width={16} className="shrink-0" />}
              <span className="flex-1 text-left text-sm font-medium whitespace-nowrap" style={{ color: item.danger ? "var(--t-status-error)" : "var(--t-text-primary)" }}>
                {item.label}
              </span>
              {item.hint && <span className="text-xs shrink-0 whitespace-nowrap text-(--t-text-dim)">{item.hint}</span>}
              {item.shortcut && !item.children && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-sm font-mono shrink-0 bg-(--t-bg-elevated) text-(--t-text-dim) border border-(--t-border)">
                  {item.shortcut}
                </span>
              )}
              {item.children && (
                <Icon icon="lucide:chevron-right" width={14} className="shrink-0 text-(--t-text-dim)" />
              )}
            </button>
          </div>
        );
      })}

      {activeSub !== null && items[activeSub.idx]?.children &&
        createPortal(
          <SubmenuPanel x={activeSub.x} y={activeSub.y} onMouseEnter={clearTimer} onMouseLeave={scheduleClose}>
            <MenuItemList
              items={items[activeSub.idx].children!}
              onClose={onClose}
            />
          </SubmenuPanel>,
          document.body,
        )
      }
    </div>
  );
}

// ── Right-click context menu (fixed, portal) ──────────────────────────────────

const VIEWPORT_MARGIN = 8;

export function fitWithin(start: number, size: number, limit: number): number {
  return Math.min(start, Math.max(VIEWPORT_MARGIN, limit - size - VIEWPORT_MARGIN));
}

function useFittedStart(
  ref: React.RefObject<HTMLElement | null>,
  start: number,
  axis: "width" | "height",
  deps: unknown[],
): number {
  const [fitted, setFitted] = useState(start);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => setFitted(fitWithin(
      start,
      el.getBoundingClientRect()[axis],
      axis === "width" ? window.innerWidth : window.innerHeight,
    ));
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, axis, ref, ...deps]);
  return fitted;
}

function SubmenuPanel({ x, y, onMouseEnter, onMouseLeave, children }: {
  x: number;
  y: number;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const top = useFittedStart(ref, y, "height", []);
  return (
    <div
      ref={ref}
      // PickerSurface treats this marker as inside-click; z-index keeps a flipped submenu above its parent.
      data-menu-portal=""
      className="surface-float fixed z-10000 p-1.5 flex flex-col min-w-[12.667rem] overflow-y-auto"
      style={{ left: x, top, maxHeight: window.innerHeight - 2 * VIEWPORT_MARGIN }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {children}
    </div>
  );
}

interface ContextMenuProps {
  items: ContextMenuItem[];
  pos: { x: number; y: number };
  onClose: () => void;
  direction?: "up" | "down";
}

export function ContextMenu({ items, pos, onClose, direction = "down" }: ContextMenuProps) {
  const uiScale = useUIStore((s) => s.uiScale);
  const menuRef = useRef<HTMLDivElement>(null);
  const left = useFittedStart(menuRef, pos.x, "width", [uiScale, items]);

  // Closing from window capture rather than behind a full-screen backdrop: the
  // backdrop swallowed the next right-click, so with one menu open, right-
  // clicking another target did nothing at all. Capture runs before React's own
  // handlers and does not preventDefault, so the event still reaches whatever
  // is under the pointer and that target opens its own menu in the same event.
  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      const target = e.target;
      if (target instanceof Element && (menuRef.current?.contains(target) || target.closest("[data-menu-portal]"))) return;
      onClose();
    };
    window.addEventListener("mousedown", onOutside, true);
    window.addEventListener("contextmenu", onOutside, true);
    return () => {
      window.removeEventListener("mousedown", onOutside, true);
      window.removeEventListener("contextmenu", onOutside, true);
    };
  }, [onClose]);

  const maxHeight = direction === "up" ? pos.y - 8 : window.innerHeight - pos.y - 8;

  const placement = direction === "up"
    ? { bottom: window.innerHeight - pos.y, transformOrigin: "bottom left" }
    : { top: pos.y, transformOrigin: "top left" };

  return createPortal(
    <div
      ref={menuRef}
      data-menu-portal=""
      className="surface-float fixed z-100 p-1.5 flex flex-col min-w-[12.667rem] overflow-y-auto"
      style={{
        left,
        maxHeight,
        transform: `scale(${uiScale})`,
        ...placement,
      }}
    >
      <MenuItemList items={items} onClose={onClose} />
    </div>,
    document.body,
  );
}

const ANCHOR_GAP = 4;

export function useContextMenu() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const open = (e: React.MouseEvent) => { e.preventDefault(); setPos({ x: e.clientX, y: e.clientY }); };
  /**
   * Anchor under an element instead of under the pointer. A left-click trigger is
   * usually wide (a vault name), so pointer coordinates place the menu arbitrarily.
   */
  const openAt = (rect: { left: number; bottom: number }) =>
    setPos({ x: rect.left, y: rect.bottom + ANCHOR_GAP });
  const close = () => setPos(null);
  return { pos, open, openAt, close };
}
