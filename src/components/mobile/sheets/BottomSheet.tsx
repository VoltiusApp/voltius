import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import { useBackInterceptor } from "@/hooks/useBackInterceptor";

/**
 * Mobile bottom sheet: scrim tap + drag-down dismiss. Children scroll internally.
 * Controlled: parent owns open state via onClose. All dismiss gestures route
 * through requestClose, which plays the slide-out animation and then calls
 * onClose on transition end (so the parent unmounts after the exit, not before).
 */
export default function BottomSheet({ onClose, children, title, registerBack = true }: {
  onClose: () => void;
  children: ReactNode;
  title?: string;
  /** Close on Android hardware-back. Set false for nav-store-driven sheets that
   *  already reserve a back press via the mobileNav `sheet` trap. */
  registerBack?: boolean;
}) {
  const [dragY, setDragY] = useState(0);
  const dragYRef = useRef(0); // mirrors dragY so onTouchEnd reads the latest value, not a stale closure
  const startY = useRef<number | null>(null);
  const [dragging, setDragging] = useState(false); // suppress the transform transition so drag tracks the finger
  const { usableHeight, offsetTop } = useVisualViewport();
  const panelRef = useRef<HTMLDivElement>(null);

  // Animate in
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Animate out: slide the panel fully below the viewport, then unmount.
  const [closing, setClosing] = useState(false);
  const [exitY, setExitY] = useState(0);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestClose = () => {
    if (closing) return;
    setDragging(false);
    setExitY((panelRef.current?.offsetHeight ?? 400) + 40);
    setClosing(true);
    // Fallback in case transitionend doesn't fire (e.g. already off-screen).
    closeTimer.current = setTimeout(onClose, 260);
  };
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  // Hardware-back routes through the exit animation too.
  useBackInterceptor(registerBack, requestClose);

  const setDrag = (y: number) => { dragYRef.current = y; setDragY(y); };

  const onTouchStart = (e: React.TouchEvent) => { startY.current = e.touches[0].clientY; setDragging(true); };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    setDrag(Math.max(0, e.touches[0].clientY - startY.current));
  };
  const onTouchEnd = () => {
    setDragging(false);
    if (dragYRef.current > 80) requestClose();
    else setDrag(0);
    startY.current = null;
  };

  const translateY = closing ? exitY : entered ? dragY : 400;

  return createPortal(
    <div
      className="fixed inset-x-0 top-0 z-40 flex flex-col justify-end"
      data-mobile-sheet
      // Track the visual viewport, not the layout viewport: when an input autofocuses, this
      // WebView scrolls the layout viewport under the keyboard (visualViewport.offsetTop > 0,
      // window.innerHeight unchanged) rather than insetting it. A bare `top: 0` then anchors the
      // sheet offsetTop px above the visible area and `justify-end` floats the panel near the top
      // of the screen. Offsetting top by offsetTop + sizing to usableHeight (== visual height)
      // pins the container to the visible region, so the panel sits flush above the keyboard.
      // Keyboard closed: offsetTop is 0 and usableHeight is the full height — identical to before.
      style={{ top: offsetTop, height: usableHeight > 0 ? usableHeight : "100%" }}
    >
      <div
        className="absolute inset-0 transition-opacity"
        style={{ background: "rgba(0,0,0,0.5)", opacity: entered && !closing ? 1 : 0 }}
        onClick={requestClose}
      />
      <div
        ref={panelRef}
        className={`relative rounded-t-2xl max-h-[80%] flex flex-col ${dragging ? "" : "transition-transform"}`}
        style={{
          background: "var(--t-bg-elevated)",
          border: "1px solid var(--t-border)",
          transform: `translateY(${translateY}px)`,
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
        onTransitionEnd={(e) => {
          if (closing && e.propertyName === "transform") {
            if (closeTimer.current) clearTimeout(closeTimer.current);
            onClose();
          }
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
    </div>,
    document.body,
  );
}
