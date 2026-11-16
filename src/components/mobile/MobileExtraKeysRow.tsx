import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { isActive, type Modifier } from "@/stores/modifierLatchCore";
import { useModifierLatchStore } from "@/stores/modifierLatchStore";
import { sendSpecialKey } from "@/services/terminalInput";
import type { SpecialKey } from "@/services/terminalKeyCore";
import { useUIStore } from "@/stores/uiStore";
import { haptic } from "@/lib/haptics";
import { EXTRA_KEYS, KEY_HOLD_MS, keyForGesture, keyGesture, modTapAction, type ExtraKey } from "./extraKeysCore";

const MODS: { mod: Modifier; label: string }[] = [ { mod: "ctrl", label: "Ctrl" }, { mod: "alt", label: "Alt" } ];

// 48 dp tall keys that share the width (all ten fit a 412 dp phone; wider screens stretch
// them, and only the panels toggle sits past the edge), flat tonal surfaces like Termux.
const KEY_CLASS = "relative flex-[1_0_38px] h-12 px-1 rounded-[10px] text-sm flex items-center justify-center";

export default function MobileExtraKeysRow({ keyboardOpen }: { keyboardOpen?: boolean }) {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const panelsOpen = useUIStore((s) => s.terminalPanelsRowOpen);
  const togglePanels = useUIStore((s) => s.toggleTerminalPanelsRow);
  const ctrl = useModifierLatchStore((s) => s.ctrl);
  const alt = useModifierLatchStore((s) => s.alt);
  const tap = useModifierLatchStore((s) => s.tap);
  const lock = useModifierLatchStore((s) => s.lock);
  const consume = useModifierLatchStore((s) => s.consume);
  const latch: Record<Modifier, typeof ctrl> = { ctrl, alt };
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastModTap = useRef<Record<Modifier, number | null>>({ ctrl: null, alt: null });
  // Tap / hold / swipe-up / scroll tracking for the keys: record the touch origin and only decide
  // on touchend (extraKeysCore.keyGesture), so dragging the row sideways never fires a key.
  const keyTouch = useRef<{ x: number; y: number; dx: number; dy: number; held: boolean; armed: boolean; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [altArmed, setAltArmed] = useState<{ key: ExtraKey; rect: DOMRect } | null>(null);

  const press = (key: SpecialKey) => {
    if (!activeSessionId) return;
    haptic("key");
    sendSpecialKey(activeSessionId, key, { ctrl: isActive(latch.ctrl), alt: isActive(latch.alt) });
    consume();
  };
  const lockMod = (mod: Modifier) => { haptic("press"); lock(mod); };
  const tapMod = (mod: Modifier) => {
    const now = performance.now();
    if (modTapAction(latch[mod], lastModTap.current[mod], now) === "lock") {
      lastModTap.current[mod] = null;
      lockMod(mod);
      return;
    }
    lastModTap.current[mod] = now;
    haptic("key");
    tap(mod);
  };
  const noFocusSteal = (e: React.SyntheticEvent) => e.preventDefault();
  // The row must never summon the soft keyboard. The xterm textarea is programmatically focused
  // (Android keeps the IME hidden), so the first touch gesture would otherwise pop the IME for it.
  // When the keyboard is closed, blur the focused element on touch so the tap can't trigger it.
  // Keyboard open: leave focus alone so it stays open for continued typing.
  const keepKeyboardClosed = () => { if (!keyboardOpen) (document.activeElement as HTMLElement | null)?.blur(); };
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
      onClick={(e) => { noFocusSteal(e); if (!("ontouchstart" in window)) press(k.key); }}
      className={`${KEY_CLASS} font-medium`}
      style={{
        background: altArmed?.key === k ? "color-mix(in srgb, var(--t-accent) 25%, var(--t-bg-card))" : "var(--t-bg-card)",
        color: "var(--t-text-primary)", border: "1px solid var(--t-border)",
      }}>
      {k.icon ? <Icon icon={k.icon} width={18} /> : k.label}
      {k.altLabel && (
        <sup data-mobile-key-alt-label aria-hidden
          className="absolute top-0.5 right-1 text-[10px] leading-none font-medium pointer-events-none"
          style={{ color: altArmed?.key === k ? "var(--t-accent)" : "var(--t-text-secondary)" }}>
          {k.altLabel}
        </sup>
      )}
    </button>
  );

  return (
    <div data-mobile-extra-keys className="shrink-0 flex items-center gap-0.5 overflow-x-auto px-1 py-1 border-t scrollbar-none"
      style={{
        background: "var(--t-bg-chrome)", borderColor: "var(--t-border)",
        // Vertical travel belongs to the swipe-up alternates; the row itself only pans sideways.
        touchAction: "pan-x",
        // Keyboard closed: the shell spans edge-to-edge, so inset the row above the Android
        // system nav bar. Keyboard open: stay flush above the keyboard (no inset; the nav bar
        // is behind the keyboard).
        paddingBottom: keyboardOpen ? undefined : "calc(var(--spacing) * 1 + var(--vt-safe-bottom))",
      }}
      onMouseDown={noFocusSteal} onTouchStart={(e) => { noFocusSteal(e); keepKeyboardClosed(); }}>
      {MODS.map(({ mod, label }) => {
        const v = latch[mod];
        return (
          <button key={mod} data-mobile-key={mod} data-latch={v}
            onMouseDown={(e) => { noFocusSteal(e); }}
            onTouchStart={(e) => {
              noFocusSteal(e);
              if (longPressTimer.current) clearTimeout(longPressTimer.current);
              // On fire, null the ref so touchend treats this as a completed lock (not a tap).
              longPressTimer.current = setTimeout(() => { longPressTimer.current = null; lockMod(mod); }, KEY_HOLD_MS);
            }}
            onTouchEnd={(e) => {
              noFocusSteal(e);
              // Timer still pending = short tap → arm/toggle (or lock on a double tap). If the
              // hold-lock already fired it nulled the ref, so we skip tapMod and keep the lock.
              if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; tapMod(mod); }
            }}
            // Row is horizontally scrollable: a scroll cancels the touch with no touchend,
            // so clear the pending lock timer to avoid a stray lock firing mid-scroll.
            onTouchCancel={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } }}
            onClick={(e) => { noFocusSteal(e); if (!("ontouchstart" in window)) tapMod(mod); }}
            className={`${KEY_CLASS} font-semibold`}
            style={{
              background: v === "locked" ? "var(--t-accent)" : v === "armed" ? "color-mix(in srgb, var(--t-accent) 35%, var(--t-bg-card))" : "var(--t-bg-card)",
              color: isActive(v) ? "#fff" : "var(--t-text-primary)", border: "1px solid var(--t-border)",
            }}>
            {label}
            {v === "locked" && (
              <span data-mobile-key-lock aria-hidden className="absolute bottom-1 left-1/2 -translate-x-1/2 w-3 h-0.5 rounded-full bg-current" />
            )}
          </button>
        );
      })}
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
      <button data-mobile-panels-toggle
        onMouseDown={noFocusSteal}
        onTouchStart={(e) => { noFocusSteal(e); keepKeyboardClosed(); }}
        onClick={(e) => { noFocusSteal(e); togglePanels(); }}
        className={`${KEY_CLASS} font-medium`}
        style={{ background: panelsOpen ? "var(--t-accent)" : "var(--t-bg-card)", color: panelsOpen ? "var(--t-on-accent)" : "var(--t-text-primary)", border: "1px solid var(--t-border)" }}>
        <Icon icon="lucide:layout-grid" width={18} />
      </button>
    </div>
  );
}
