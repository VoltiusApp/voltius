import { useRef, useState } from "react";
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
              <span className="flex-1 text-left text-sm font-medium" style={{ color: item.danger ? "var(--t-status-error)" : "var(--t-text-primary)" }}>
                {item.label}
              </span>
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

      {/* Submenus portal to body to escape any transformed ancestor */}
      {activeSub !== null && items[activeSub.idx]?.children &&
        createPortal(
          <div
            className="fixed z-101 p-1.5 rounded-xl flex flex-col bg-(--t-bg-card) border border-(--t-bg-card-hover) min-w-[12.667rem] overflow-y-auto"
            style={{ left: activeSub.x, top: activeSub.y, maxHeight: window.innerHeight - activeSub.y - 8, boxShadow: "0 8px 24px rgba(0,0,0,0.4)" }}
            onMouseEnter={clearTimer}
            onMouseLeave={scheduleClose}
          >
            <MenuItemList
              items={items[activeSub.idx].children!}
              onClose={onClose}
            />
          </div>,
          document.body,
        )
      }
    </div>
  );
}

// ── Right-click context menu (fixed, portal) ──────────────────────────────────

interface ContextMenuProps {
  items: ContextMenuItem[];
  pos: { x: number; y: number };
  onClose: () => void;
  direction?: "up" | "down";
}

export function ContextMenu({ items, pos, onClose, direction = "down" }: ContextMenuProps) {
  const uiScale = useUIStore((s) => s.uiScale);

  const maxHeight = direction === "up" ? pos.y - 8 : window.innerHeight - pos.y - 8;

  const placement = direction === "up"
    ? { bottom: window.innerHeight - pos.y, transformOrigin: "bottom left" }
    : { top: pos.y, transformOrigin: "top left" };

  return createPortal(
    <>
      {/* Backdrop at z-99: catches outside clicks without interfering with
          submenu portals at z-101. useClickOutside on mousedown was causing
          submenus to unmount before onClick fired — backdrop avoids that. */}
      <div className="fixed inset-0 z-99" onMouseDown={onClose} />
      <div
        className="fixed z-100 p-1.5 rounded-xl flex flex-col bg-(--t-bg-card) border border-(--t-bg-card-hover) min-w-[12.667rem] overflow-y-auto"
        style={{
          left: pos.x,
          maxHeight,
          transform: `scale(${uiScale})`,
          boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          ...placement,
        }}
      >
        <MenuItemList items={items} onClose={onClose} />
      </div>
    </>,
    document.body,
  );
}

export function useContextMenu() {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const open = (e: React.MouseEvent) => { e.preventDefault(); setPos({ x: e.clientX, y: e.clientY }); };
  const close = () => setPos(null);
  return { pos, open, close };
}
