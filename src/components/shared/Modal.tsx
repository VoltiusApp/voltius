import { useEffect } from "react";
import { createPortal } from "react-dom";

interface Props {
  onClose: () => void;
  onEnter?: () => void;
  children: React.ReactNode;
  blur?: boolean;
}

export function Modal({ onClose, onEnter, children, blur = false }: Props) {
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
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: blur ? "blur(2px)" : undefined }}
      onClick={onClose}
    >
      <div role="dialog" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
