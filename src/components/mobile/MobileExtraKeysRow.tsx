import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import type { Modifier } from "@/stores/modifierLatchCore";
import type { SpecialKey } from "@/services/terminalKeyCore";
import { haptic } from "@/lib/haptics";
import { EXTRA_KEYS, KEY_HOLD_MS, keyForGesture, keyGesture, type ExtraKey } from "./extraKeysCore";
import { DrawerToggle, KEY_CLASS, KEY_STYLE, LatchKey, isTouch, keepKeyboardClosed, noFocusSteal, pressKey } from "./mobileKeys";

const MODS: { mod: Modifier; label: string }[] = [ { mod: "ctrl", label: "Ctrl" }, { mod: "alt", label: "Alt" } ];

export default function MobileExtraKeysRow({ keyboardOpen }: { keyboardOpen?: boolean }) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  // Tap / hold / swipe-up / scroll tracking for the keys: record the touch origin and only decide
  // on touchend (extraKeysCore.keyGesture), so dragging the row sideways never fires a key.
  const keyTouch = useRef<{ x: number; y: number; dx: number; dy: number; held: boolean; armed: boolean; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [altArmed, setAltArmed] = useState<{ key: ExtraKey; rect: DOMRect } | null>(null);

  const press = (key: SpecialKey) => pressKey(activeSessionId, key);
  const gestureOf = (e: React.TouchEvent) => {
    const kt = keyTouch.current;
    const t = e.changedTouches[0] ?? e.touches[0];
    if (!kt || !t) return null;
    kt.dx = t.clientX - kt.x;
    kt.dy = t.clientY - kt.y;
    return keyGesture(kt.dx, kt.dy, kt.held);
  };
  const endKeyTouch = () => {
    if (keyTouch.current) clearTimeout(keyTouch.current.timer);
    keyTouch.current = null;
    setAltArmed(null);
  };
  const armAlt = (k: ExtraKey, el: HTMLElement, on: boolean) => {
    const kt = keyTouch.current;
    if (!kt || !k.alt || kt.armed === on) return;
    kt.armed = on;
    if (on) haptic("tick");
    setAltArmed(on ? { key: k, rect: el.getBoundingClientRect() } : null);
  };

  const renderKey = (k: ExtraKey) => (
    <button key={k.key} data-mobile-key={k.key} data-mobile-key-alt={k.alt}
      data-alt-armed={altArmed?.key === k ? "" : undefined}
      onMouseDown={noFocusSteal}
      onTouchStart={(e) => {
        noFocusSteal(e);
        endKeyTouch();
        const t = e.touches[0];
        if (!t) return;
        const el = e.currentTarget;
        const timer = setTimeout(() => {
          const kt = keyTouch.current;
          if (!kt) return;
          kt.held = true;
          armAlt(k, el, keyGesture(kt.dx, kt.dy, true) === "alt");
        }, KEY_HOLD_MS);
        keyTouch.current = { x: t.clientX, y: t.clientY, dx: 0, dy: 0, held: false, armed: false, timer };
      }}
      onTouchMove={(e) => armAlt(k, e.currentTarget, gestureOf(e) === "alt")}
      onTouchEnd={(e) => {
        noFocusSteal(e);
        const g = gestureOf(e);
        endKeyTouch();
        const key = g && keyForGesture(k, g);
        if (key) press(key);
      }}
      onTouchCancel={endKeyTouch}
      onClick={(e) => { noFocusSteal(e); if (!isTouch()) press(k.key); }}
      className={`${KEY_CLASS} font-medium`}
      style={{ ...KEY_STYLE, ...(altArmed?.key === k && { background: "color-mix(in srgb, var(--t-accent) 25%, var(--t-bg-card))" }) }}>
      <span className="mt-2.5 flex">{k.icon ? <Icon icon={k.icon} width={16} /> : k.label}</span>
      {k.altLabel && (
        <sup data-mobile-key-alt-label aria-hidden
          className="absolute top-[3px] right-1 text-[9px] leading-none font-medium pointer-events-none"
          style={{ color: altArmed?.key === k ? "var(--t-accent)" : "var(--t-text-secondary)" }}>
          {k.altLabel}
        </sup>
      )}
    </button>
  );

  return (
    <div data-mobile-extra-keys className="shrink-0 flex items-center gap-0.5 overflow-x-auto px-1 py-0.5 border-t scrollbar-none"
      style={{
        background: "var(--t-bg-chrome)", borderColor: "var(--t-border)",
        // Vertical travel belongs to the swipe-up alternates; the row itself only pans sideways.
        touchAction: "pan-x",
        // Keyboard closed: the shell spans edge-to-edge, so inset the row above the Android
        // system nav bar. Keyboard open: stay flush above the keyboard (no inset; the nav bar
        // is behind the keyboard).
        paddingBottom: keyboardOpen ? undefined : "calc(var(--spacing) * 0.5 + var(--vt-safe-bottom))",
      }}
      onMouseDown={noFocusSteal} onTouchStart={(e) => { noFocusSteal(e); keepKeyboardClosed(keyboardOpen); }}>
      {MODS.map(({ mod, label }) => (
        <LatchKey key={mod} mod={mod} className={`${KEY_CLASS} font-semibold`}>{label}</LatchKey>
      ))}
      {EXTRA_KEYS.map(renderKey)}
      {altArmed && createPortal(
        <div data-mobile-key-alt-popup aria-hidden
          className="fixed z-[1000] pointer-events-none flex items-center justify-center h-14 px-3 rounded-xl text-xl font-semibold shadow-lg"
          style={{
            left: altArmed.rect.left + altArmed.rect.width / 2, top: altArmed.rect.top - 6,
            minWidth: altArmed.rect.width + 8, transform: "translate(-50%, -100%)",
            background: "var(--t-accent)", color: "var(--t-on-accent)",
          }}>
          {altArmed.key.altLabel}
        </div>,
        document.body,
      )}
      <DrawerToggle className={`${KEY_CLASS} font-medium`} keyboardOpen={keyboardOpen} />
    </div>
  );
}
