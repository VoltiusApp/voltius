import { useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";

export function InfoTooltip({
  text,
  children,
  icon = "lucide:info",
  iconColor,
  width = 14,
  placement = "bottom",
  interactive = false,
}: {
  text?: string;
  /** Rich tooltip body; takes precedence over `text`. Required for clickable content. */
  children?: ReactNode;
  icon?: string;
  iconColor?: string;
  width?: number;
  placement?: "top" | "bottom";
  /** When true the tooltip accepts pointer events and lingers, so links inside are clickable. */
  interactive?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const hideTimer = useRef<number | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const show = () => {
    if (hideTimer.current) { clearTimeout(hideTimer.current); hideTimer.current = null; }
    if (btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: placement === "top" ? r.top - 6 : r.bottom + 6, left: r.left + r.width / 2 });
    }
    setVisible(true);
  };
  // Interactive tooltips wait briefly so the pointer can travel onto the card.
  const hide = () => {
    if (interactive) hideTimer.current = window.setTimeout(() => setVisible(false), 120);
    else setVisible(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        className="flex items-center justify-center text-[var(--t-text-dim)]"
        style={iconColor ? { color: iconColor } : undefined}
        tabIndex={-1}
      >
        <Icon icon={icon} width={width} />
      </button>
      {visible && createPortal(
        <div
          onMouseEnter={interactive ? show : undefined}
          onMouseLeave={interactive ? hide : undefined}
          className={`fixed z-[9999] px-3 py-2 rounded-lg text-xs leading-relaxed bg-[var(--t-bg-card-hover)] border border-[var(--t-border)] text-[var(--t-text-secondary)] ${interactive ? "" : "pointer-events-none"}`}
          style={{
            top: pos.top,
            left: pos.left,
            transform: placement === "top" ? "translate(-50%, -100%)" : "translateX(-50%)",
            boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
            width: "17.333rem",
          }}
        >
          {children ?? text}
        </div>,
        document.body,
      )}
    </>
  );
}
