import { useEffect } from "react";
import { createPortal } from "react-dom";

interface Props {
  onClose: () => void;
  onEnter?: () => void;
  children: React.ReactNode;
  /** Backdrop blur strength. `true` (default) blurs the scrim; `false` keeps it flat. */
  blur?: boolean;
}

export function Modal({ onClose, onEnter, children, blur = true }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && onEnter) { e.stopPropagation(); onEnter(); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, onEnter]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{
        background: "rgba(0,0,0,0.5)",
        backdropFilter: blur ? "blur(10px) saturate(1.2)" : undefined,
        WebkitBackdropFilter: blur ? "blur(10px) saturate(1.2)" : undefined,
      }}
      onClick={onClose}
    >
      <div role="dialog" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Shared dialog shell. Both variants carry the same ring + top-edge highlight
 * and modal-level elevation tokens, so they read as one family; only the fill
 * differs by surface role (see docs/design-surfaces.md):
 *  - default (glass): translucent + blurred, for lightweight transient dialogs
 *    (confirm, small prompts).
 *  - `solid`: opaque, no blur, for dense content/reading surfaces (changelog,
 *    settings) where legibility comes first.
 * Use instead of hand-rolling `bg-(--t-bg-card) border ... boxShadow`.
 */
export function ModalCard({
  children,
  className = "",
  style,
  solid = false,
}: {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  solid?: boolean;
}) {
  return (
    <div
      className={`${solid ? "surface-modal-solid" : "surface-glass-modal"} rounded-[var(--r-lg)] mx-4 ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
