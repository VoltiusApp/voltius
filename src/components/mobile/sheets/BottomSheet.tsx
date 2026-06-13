import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Mobile bottom sheet: scrim tap + drag-down dismiss. Children scroll internally.
 * Controlled: parent owns open state via onClose.
 */
export default function BottomSheet({ onClose, children, title }: {
  onClose: () => void;
  children: ReactNode;
  title?: string;
}) {
  const [dragY, setDragY] = useState(0);
  const dragYRef = useRef(0); // mirrors dragY so onTouchEnd reads the latest value, not a stale closure
  const startY = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false); // suppress the transform transition so drag tracks the finger

  // Animate in
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  const setDrag = (y: number) => { dragYRef.current = y; setDragY(y); };

  const onTouchStart = (e: React.TouchEvent) => { startY.current = e.touches[0].clientY; setDragging(true); };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    setDrag(Math.max(0, e.touches[0].clientY - startY.current));
  };
  const onTouchEnd = () => {
    setDragging(false);
    if (dragYRef.current > 80) onClose();
    else setDrag(0);
    startY.current = null;
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col justify-end" data-mobile-sheet>
      <div
        className="absolute inset-0 transition-opacity"
        style={{ background: "rgba(0,0,0,0.5)", opacity: entered ? 1 : 0 }}
        onClick={onClose}
      />
      <div
        className={`relative rounded-t-2xl max-h-[80%] flex flex-col ${dragging ? "" : "transition-transform"}`}
        style={{
          background: "var(--t-bg-elevated)",
          border: "1px solid var(--t-border)",
          transform: `translateY(${entered ? dragY : 400}px)`,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        <div
          className="shrink-0 flex flex-col items-center pt-2 pb-1"
          onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        >
          <div className="w-9 h-1 rounded-full" style={{ background: "var(--t-border)" }} />
          {title && <div className="text-sm font-semibold mt-2 text-(--t-text-primary)">{title}</div>}
        </div>
        <div className="overflow-y-auto px-2 pb-2">{children}</div>
      </div>
    </div>
  );
}
