import { useRef } from "react";
import { Icon } from "@iconify/react";
import { useSessionStore } from "@/stores/sessionStore";
import { isActive, type Modifier } from "@/stores/modifierLatchCore";
import { useModifierLatchStore } from "@/stores/modifierLatchStore";
import { sendSpecialKey } from "@/services/terminalInput";
import type { SpecialKey } from "@/stores/terminalKeyCore";
import { useUIStore } from "@/stores/uiStore";

type KeyDef = { key: SpecialKey; label?: string; icon?: string };
const KEYS: KeyDef[] = [
  { key: "Esc", label: "Esc" }, { key: "Tab", label: "Tab" }, { key: "ShiftTab", label: "⇧Tab" },
  { key: "Up", icon: "lucide:arrow-up" }, { key: "Down", icon: "lucide:arrow-down" },
  { key: "Left", icon: "lucide:arrow-left" }, { key: "Right", icon: "lucide:arrow-right" },
  { key: "-", label: "-" }, { key: "/", label: "/" }, { key: "|", label: "|" }, { key: "~", label: "~" },
  { key: "Home", label: "Home" }, { key: "End", label: "End" }, { key: "PgUp", label: "PgUp" }, { key: "PgDn", label: "PgDn" },
];
const MODS: { mod: Modifier; label: string }[] = [ { mod: "ctrl", label: "Ctrl" }, { mod: "alt", label: "Alt" } ];

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
  // Tap-vs-scroll tracking for KEYS: record the touch origin, only fire on touchend
  // if the finger barely moved (a real tap, not a horizontal scroll-drag of the row).
  const keyTouchStart = useRef<{ x: number; y: number } | null>(null);
  const TAP_MOVE_PX = 10;

  const press = (key: SpecialKey) => {
    if (!activeSessionId) return;
    sendSpecialKey(activeSessionId, key, { ctrl: isActive(latch.ctrl), alt: isActive(latch.alt) });
    consume();
  };
  const tapMod = (mod: Modifier) => tap(mod);
  const lockMod = (mod: Modifier) => lock(mod);
  const noFocusSteal = (e: React.SyntheticEvent) => e.preventDefault();
  // The row must never summon the soft keyboard. The xterm textarea is programmatically focused
  // (Android keeps the IME hidden), so the first touch gesture would otherwise pop the IME for it.
  // When the keyboard is closed, blur the focused element on touch so the tap can't trigger it.
  // Keyboard open: leave focus alone so it stays open for continued typing.
  const keepKeyboardClosed = () => { if (!keyboardOpen) (document.activeElement as HTMLElement | null)?.blur(); };

  return (
    <div data-mobile-extra-keys className="shrink-0 flex items-center gap-1 overflow-x-auto px-1.5 py-1.5 border-t"
      style={{
        background: "var(--t-bg-chrome)", borderColor: "var(--t-border)",
        // Keyboard closed: the shell spans edge-to-edge, so inset the row above the Android
        // system nav bar. Keyboard open: stay flush above the keyboard (no inset; the nav bar
        // is behind the keyboard).
        paddingBottom: keyboardOpen ? undefined : "env(safe-area-inset-bottom)",
      }}
      onMouseDown={noFocusSteal} onTouchStart={(e) => { noFocusSteal(e); keepKeyboardClosed(); }}>
      {MODS.map(({ mod, label }) => {
        const v = latch[mod];
        return (
          <button key={mod} data-mobile-key={mod}
            onMouseDown={(e) => { noFocusSteal(e); }}
            onTouchStart={(e) => {
              noFocusSteal(e);
              if (longPressTimer.current) clearTimeout(longPressTimer.current);
              // On fire, null the ref so touchend treats this as a completed lock (not a tap).
              longPressTimer.current = setTimeout(() => { longPressTimer.current = null; lockMod(mod); }, 450);
            }}
            onTouchEnd={(e) => {
              noFocusSteal(e);
              // Timer still pending = short tap → arm/toggle. If the lock already fired it
              // nulled the ref, so we skip tapMod and keep the lock.
              if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; tapMod(mod); }
            }}
            // Row is horizontally scrollable: a scroll cancels the touch with no touchend,
            // so clear the pending lock timer to avoid a stray lock firing mid-scroll.
            onTouchCancel={() => { if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; } }}
            onClick={(e) => { noFocusSteal(e); if (!("ontouchstart" in window)) tapMod(mod); }}
            className="shrink-0 min-w-11 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
            style={{
              background: v === "locked" ? "var(--t-accent)" : v === "armed" ? "color-mix(in srgb, var(--t-accent) 35%, var(--t-bg-card))" : "var(--t-bg-card)",
              color: isActive(v) ? "#fff" : "var(--t-text-primary)", border: "1px solid var(--t-border)",
            }}>
            {label}
          </button>
        );
      })}
      {KEYS.map(({ key, label, icon }) => (
        <button key={key} data-mobile-key={key}
          // Touch path: fire once on touchend (a tap), never on touchstart — so the row
          // can be scrolled by dragging a button without firing its key, and the ghost
          // mousedown/click is suppressed on touch (mirrors the MODS' onClick guard).
          onMouseDown={noFocusSteal}
          onTouchStart={(e) => {
            noFocusSteal(e);
            const t = e.touches[0];
            keyTouchStart.current = t ? { x: t.clientX, y: t.clientY } : null;
          }}
          onTouchEnd={(e) => {
            noFocusSteal(e);
            const start = keyTouchStart.current;
            keyTouchStart.current = null;
            const t = e.changedTouches[0];
            if (!start || !t) return;
            if (Math.hypot(t.clientX - start.x, t.clientY - start.y) < TAP_MOVE_PX) press(key);
          }}
          onTouchCancel={() => { keyTouchStart.current = null; }}
          onClick={(e) => { noFocusSteal(e); if (!("ontouchstart" in window)) press(key); }}
          className="shrink-0 min-w-11 px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center"
          style={{ background: "var(--t-bg-card)", color: "var(--t-text-primary)", border: "1px solid var(--t-border)" }}>
          {icon ? <Icon icon={icon} width={16} /> : label}
        </button>
      ))}
      <button data-mobile-panels-toggle
        onMouseDown={noFocusSteal}
        onTouchStart={(e) => { noFocusSteal(e); keepKeyboardClosed(); }}
        onClick={(e) => { noFocusSteal(e); togglePanels(); }}
        className="shrink-0 min-w-11 px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center"
        style={{ background: panelsOpen ? "var(--t-accent)" : "var(--t-bg-card)", color: panelsOpen ? "#fff" : "var(--t-text-primary)", border: "1px solid var(--t-border)" }}>
        <Icon icon="lucide:layout-grid" width={16} />
      </button>
    </div>
  );
}
