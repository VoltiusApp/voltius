import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useNotificationStore, type ToastEntry } from "@/stores/notificationStore";
import { SNACKBAR_MOTION, animate } from "@/lib/motion";
import { haptic } from "@/lib/haptics";
import { VelocityTracker } from "./sheets/sheetDrag";
import { avoidLift, dockedInset, snackbarDuration, swipeAction, swipeOpacity } from "./snackbarCore";

/** Docked bottom chrome the snackbar sits above (plus `data-snackbar-anchor` for screen-specific bars). */
const DOCKED = "[data-mobile-tab-bar], [data-mobile-keys-drawer], [data-mobile-extra-keys], [data-snackbar-anchor]";

const visible = (el: Element) => el.checkVisibility?.({ visibilityProperty: true }) ?? getComputedStyle(el).visibility !== "hidden";

/** px of docked chrome at the bottom of the viewport, re-measured while shown (keyboard, bar slide, tab change). */
function useDockedInset(): number | null {
  const [inset, setInset] = useState<number | null>(null);
  useEffect(() => {
    const measure = () => {
      const boxes = [...document.querySelectorAll(DOCKED)].filter(visible).map((el) => el.getBoundingClientRect());
      setInset(dockedInset(boxes, window.innerHeight));
    };
    measure();
    const id = setInterval(measure, 250);
    window.addEventListener("resize", measure);
    window.addEventListener("voltius:insets", measure);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("voltius:insets", measure);
    };
  }, []);
  return inset;
}

/** Where its rest position puts an element's bottom edge, ignoring transforms / translate. */
function restBottom(el: HTMLElement): number {
  const parent = el.offsetParent?.getBoundingClientRect().top ?? 0;
  return parent + el.offsetTop + el.offsetHeight;
}

/**
 * `[data-snackbar-avoid]` elements (the Hosts FAB) rise above the snackbar while it shows and
 * come back down as it leaves, like M3's FAB / snackbar coordination. `down` = leaving.
 */
function useSnackbarAvoiders(ref: RefObject<HTMLDivElement | null>, down: boolean) {
  useEffect(() => {
    const lifted = new Map<HTMLElement, number>();
    const move = (el: HTMLElement, to: number) => {
      const from = lifted.get(el) ?? 0;
      if (from === to) return;
      lifted.set(el, to);
      el.style.translate = to ? `0 ${-to}px` : "";
      const { duration, easing } = to > from ? SNACKBAR_MOTION.enter : SNACKBAR_MOTION.exit;
      if (typeof el.animate === "function") animate(el, [{ translate: `0 ${-from}px` }, { translate: `0 ${-to}px` }], duration, easing);
    };
    const measure = () => {
      const bar = ref.current;
      // Rest top of the (fixed) snackbar: its enter shift / swipe transforms don't count.
      const top = bar && !down ? window.innerHeight - parseFloat(getComputedStyle(bar).bottom) - bar.offsetHeight : null;
      for (const el of document.querySelectorAll<HTMLElement>("[data-snackbar-avoid]")) {
        move(el, top === null || !el.offsetParent ? 0 : avoidLift(restBottom(el), top, SNACKBAR_MOTION.gapPx));
      }
      for (const el of [...lifted.keys()]) if (!el.isConnected) lifted.delete(el);
    };
    measure();
    const id = setInterval(measure, 250);
    return () => {
      clearInterval(id);
      for (const el of [...lifted.keys()]) move(el, 0);
    };
  }, [ref, down]);
}

/**
 * Android rendering of the app's toasts (notificationStore) as M3 snackbars: one at a
 * time, oldest first (the store's list is the queue), at the bottom above the navigation
 * bar / extra-keys row / keyboard. Progress toasts keep their own card (ToastStack).
 */
export default function MobileSnackbarHost() {
  const toast = useNotificationStore((s) => s.toasts.find((t) => t.type === "toast"));
  return toast ? <Snackbar key={toast.id} toast={toast} /> : null;
}

function Snackbar({ toast }: { toast: ToastEntry }) {
  const { t } = useTranslation();
  const dismissToast = useNotificationStore((s) => s.dismissToast);
  const ref = useRef<HTMLDivElement>(null);
  const inset = useDockedInset();
  const leaving = useRef(false);
  const [exiting, setExiting] = useState(false);
  useSnackbarAvoiders(ref, exiting);
  const [held, setHeld] = useState(false);
  const drag = useRef<{ x0: number; dx: number; dragging: boolean; tracker: VelocityTracker } | null>(null);
  const dragged = useRef(false);

  /** Animate out (sideways after a swipe, else a fade), then drop it from the queue. */
  const leave = useCallback((dx = 0) => {
    if (leaving.current) return;
    leaving.current = true;
    setExiting(true);
    const el = ref.current;
    const done = () => dismissToast(toast.id);
    if (!el || typeof el.animate !== "function") return done();
    const { duration, easing } = SNACKBAR_MOTION.exit;
    const frames = dx
      ? [{ transform: `translateX(${dx}px)`, opacity: swipeOpacity(dx, el.offsetWidth) }, { transform: `translateX(${Math.sign(dx) * el.offsetWidth}px)`, opacity: 0 }]
      : [{ opacity: 1 }, { opacity: 0 }];
    animate(el, frames, duration, easing, { fill: "forwards" }).finished.then(done, done);
  }, [dismissToast, toast.id]);

  useEffect(() => {
    if (toast.severity === "error") haptic("reject");
    const el = ref.current;
    if (!el || typeof el.animate !== "function") return;
    const { duration, easing } = SNACKBAR_MOTION.enter;
    animate(el, [{ opacity: 0, translate: `0 ${SNACKBAR_MOTION.enterShiftPx}px` }, { opacity: 1, translate: "0 0" }], duration, easing);
  }, []);

  // Auto-dismiss; a finger on it holds the timer (restarted in full on release).
  useEffect(() => {
    const ms = snackbarDuration(toast.duration, !!toast.action);
    if (held || ms === 0) return;
    const id = setTimeout(() => leave(), ms);
    return () => clearTimeout(id);
  }, [held, toast.duration, toast.action, leave]);

  const place = (dx: number) => {
    const el = ref.current;
    if (!el) return;
    el.style.transform = dx ? `translateX(${dx}px)` : "";
    el.style.opacity = dx ? String(swipeOpacity(dx, el.offsetWidth)) : "";
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const x = e.touches[0]?.clientX ?? 0;
    const tracker = new VelocityTracker();
    tracker.add(e.timeStamp, x);
    drag.current = { x0: x, dx: 0, dragging: false, tracker };
    dragged.current = false;
    setHeld(true);
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const g = drag.current;
    const x = e.touches[0]?.clientX;
    if (!g || x === undefined || leaving.current) return;
    g.dx = x - g.x0;
    g.tracker.add(e.timeStamp, x);
    if (!g.dragging && Math.abs(g.dx) >= SNACKBAR_MOTION.slopPx) g.dragging = dragged.current = true;
    if (g.dragging) place(g.dx);
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const g = drag.current;
    drag.current = null;
    setHeld(false);
    if (!g?.dragging || leaving.current) return;
    const v = e.type === "touchend" ? g.tracker.velocity(e.timeStamp) : 0;
    const el = ref.current;
    if (swipeAction(g.dx, v, el?.offsetWidth ?? 0) === "dismiss") return leave(g.dx);
    place(0);
    if (el && typeof el.animate === "function") {
      const { duration, easing } = SNACKBAR_MOTION.settle;
      animate(el, [{ transform: `translateX(${g.dx}px)`, opacity: swipeOpacity(g.dx, el.offsetWidth) }, { transform: "none", opacity: 1 }], duration, easing);
    }
  };

  const sticky = snackbarDuration(toast.duration, !!toast.action) === 0;
  const gap = SNACKBAR_MOTION.gapPx;
  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      data-mobile-snackbar={toast.severity}
      data-no-ripple
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
      className="fixed z-50 mx-auto flex items-center gap-1 rounded-[4px] min-h-12 pl-4 pr-2 py-1.5 shadow-lg"
      style={{
        left: `calc(var(--vt-safe-left) + ${gap}px)`,
        right: `calc(var(--vt-safe-right) + ${gap}px)`,
        bottom: inset !== null ? `${inset + gap}px` : `calc(var(--vt-safe-bottom) + ${gap}px)`,
        maxWidth: 560,
        touchAction: "pan-y",
        // M3 inverse surface: the snackbar reads against any screen under it.
        background: "var(--t-text-bright)",
        color: "var(--t-bg-base)",
      }}
    >
      <span className="flex-1 min-w-0 py-1.5 text-sm line-clamp-2 break-words" title={toast.message}>{toast.message}</span>
      {toast.action && (
        <button
          data-mobile-snackbar-action
          className="vt-hit shrink-0 px-3 h-10 rounded-full text-sm font-semibold"
          style={{ color: "color-mix(in srgb, var(--t-accent) 55%, var(--t-bg-base))" }}
          onClick={() => {
            if (dragged.current) return;
            toast.action!.onClick();
            leave();
          }}
        >
          {toast.action.label}
        </button>
      )}
      {sticky && (
        <button data-mobile-snackbar-close aria-label={t("common.action.dismiss")} className="vt-hit shrink-0 w-10 h-10 flex items-center justify-center rounded-full" onClick={() => leave()}>
          <Icon icon="lucide:x" width={18} />
        </button>
      )}
    </div>
  );
}
