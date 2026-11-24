import { useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useUIStore } from "@/stores/uiStore";
import { isActive, type LatchValue, type Modifier } from "@/stores/modifierLatchCore";
import { takeLatchMods, useModifierLatchStore } from "@/stores/modifierLatchStore";
import { sendSpecialKey } from "@/services/terminalInput";
import type { SpecialKey } from "@/services/terminalKeyCore";
import { haptic } from "@/lib/haptics";
import { KEY_HOLD_MS, KEY_TAP_SLOP_PX, modTapAction } from "./extraKeysCore";

/** 38 dp keys that share the width like an IME row (Termux-sized): all eleven fit a 412 dp phone. */
export const KEY_CLASS = "relative flex-[1_0_34px] h-[38px] px-1 rounded-[9px] text-sm flex items-center justify-center";

export const KEY_STYLE: React.CSSProperties = {
  background: "var(--t-bg-card)", color: "var(--t-text-primary)", border: "1px solid var(--t-border)",
};

export const noFocusSteal = (e: React.SyntheticEvent) => e.preventDefault();

/** Mouse clicks only: on touch the key acts on touchend, and the synthetic click must not repeat it. */
export const isTouch = () => "ontouchstart" in window;

/** The key strips must never summon the soft keyboard. xterm's textarea is focused programmatically
 *  (Android keeps the IME hidden), so with the keyboard closed a touch blurs it first. */
export function keepKeyboardClosed(keyboardOpen: boolean | undefined) {
  if (!keyboardOpen) (document.activeElement as HTMLElement | null)?.blur();
}

/** A key press from the row or the drawer: the latched Ctrl/Alt/Shift apply once. */
export function pressKey(sessionId: string | null, key: SpecialKey) {
  if (!sessionId) return;
  haptic("key");
  sendSpecialKey(sessionId, key, takeLatchMods());
}

/** Touch handlers for a plain key: fires on release unless the finger travelled (a scroll or a slide off). */
export function useTapKey(onPress: () => void) {
  const origin = useRef<{ x: number; y: number } | null>(null);
  return {
    onMouseDown: noFocusSteal,
    onTouchStart: (e: React.TouchEvent) => {
      noFocusSteal(e);
      const t = e.touches[0];
      origin.current = t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: React.TouchEvent) => {
      noFocusSteal(e);
      const o = origin.current, t = e.changedTouches[0];
      origin.current = null;
      if (o && t && Math.hypot(t.clientX - o.x, t.clientY - o.y) < KEY_TAP_SLOP_PX) onPress();
    },
    onTouchCancel: () => { origin.current = null; },
    onClick: (e: React.MouseEvent) => { noFocusSteal(e); if (!isTouch()) onPress(); },
  };
}

function latchBackground(v: LatchValue): string {
  if (v === "locked") return "var(--t-accent)";
  return v === "armed" ? "color-mix(in srgb, var(--t-accent) 35%, var(--t-bg-card))" : "var(--t-bg-card)";
}

/** Ctrl / Alt / Shift: tap arms it for one key, a double tap or a hold locks it, a tap turns it off. */
export function LatchKey({ mod, className, children }: { mod: Modifier; className: string; children: ReactNode }) {
  const value = useModifierLatchStore((s) => s[mod]);
  const tap = useModifierLatchStore((s) => s.tap);
  const lock = useModifierLatchStore((s) => s.lock);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTap = useRef<number | null>(null);

  const lockMod = () => { haptic("press"); lock(mod); };
  const tapMod = () => {
    const now = performance.now();
    if (modTapAction(useModifierLatchStore.getState()[mod], lastTap.current, now) === "lock") {
      lastTap.current = null;
      lockMod();
      return;
    }
    lastTap.current = now;
    haptic("key");
    tap(mod);
  };
  const clearHold = () => { if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } };

  return (
    <button data-mobile-key={mod} data-latch={value}
      onMouseDown={noFocusSteal}
      onTouchStart={(e) => {
        noFocusSteal(e);
        clearHold();
        // A fired hold nulls the timer, so touchend sees a completed lock rather than a tap.
        holdTimer.current = setTimeout(() => { holdTimer.current = null; lockMod(); }, KEY_HOLD_MS);
      }}
      onTouchEnd={(e) => {
        noFocusSteal(e);
        if (holdTimer.current) { clearHold(); tapMod(); }
      }}
      onTouchCancel={clearHold}
      onClick={(e) => { noFocusSteal(e); if (!isTouch()) tapMod(); }}
      className={className}
      style={{
        background: latchBackground(value),
        color: isActive(value) ? "#fff" : "var(--t-text-primary)", border: "1px solid var(--t-border)",
      }}>
      {children}
      {value === "locked" && (
        <span data-mobile-key-lock aria-hidden className="absolute bottom-1 left-1/2 -translate-x-1/2 w-3 h-0.5 rounded-full bg-current" />
      )}
    </button>
  );
}

/** Opens and closes the keys drawer: the row's last key, or a floating button with a hardware keyboard. */
export function DrawerToggle({ className, keyboardOpen, style }: { className: string; keyboardOpen?: boolean; style?: React.CSSProperties }) {
  const { t } = useTranslation();
  const open = useUIStore((s) => s.terminalKeysDrawerOpen);
  const toggle = useUIStore((s) => s.toggleTerminalKeysDrawer);
  return (
    <button data-mobile-keys-drawer-toggle aria-pressed={open} aria-label={t("mobile.keysDrawer.toggleAriaLabel")}
      onMouseDown={noFocusSteal}
      onTouchStart={(e) => { noFocusSteal(e); keepKeyboardClosed(keyboardOpen); }}
      onClick={(e) => { noFocusSteal(e); haptic("key"); toggle(); }}
      className={className}
      style={{ ...KEY_STYLE, ...style, ...(open && { background: "var(--t-accent)", color: "var(--t-on-accent)" }) }}>
      <Icon icon="lucide:layout-grid" width={18} />
    </button>
  );
}
