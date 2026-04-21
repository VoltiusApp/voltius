import { useEffect } from "react";
import { matchShortcut } from "@/stores/shortcutStore";

const MAX_HISTORY = 100;
const PUSH_INTERVAL = 500;

interface InputHistory {
  past: string[];
  future: string[];
  lastPushAt: number;
}

const histories = new WeakMap<Element, InputHistory>();
let suppressNext = false;

const nativeInputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
const nativeTextareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;

function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const setter = el instanceof HTMLTextAreaElement ? nativeTextareaSetter : nativeInputSetter;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function getOrCreate(el: Element, currentValue: string): InputHistory {
  let h = histories.get(el);
  if (!h) {
    h = { past: [currentValue], future: [], lastPushAt: 0 };
    histories.set(el, h);
  }
  return h;
}

export function useInputUndo() {
  useEffect(() => {
    const onInput = (e: Event) => {
      if (suppressNext) { suppressNext = false; return; }
      const target = e.target as HTMLInputElement | HTMLTextAreaElement;
      if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") return;
      if ((target as HTMLInputElement).type === "password") return;

      const h = getOrCreate(target, target.value);
      const now = Date.now();
      const newValue = target.value;

      if (now - h.lastPushAt > PUSH_INTERVAL) {
        h.past = [...h.past, newValue].slice(-MAX_HISTORY);
        h.future = [];
        h.lastPushAt = now;
      } else {
        // Same burst — update the current entry in place
        h.past = [...h.past.slice(0, -1), newValue];
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const isUndo = matchShortcut("undo", e);
      const isRedo = matchShortcut("redo", e);
      if (!isUndo && !isRedo) return;

      const target = e.target as HTMLElement;
      if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") return;
      if ((target as HTMLInputElement).type === "password") return;

      e.preventDefault();

      const el = target as HTMLInputElement | HTMLTextAreaElement;
      const h = getOrCreate(el, el.value);

      if (isRedo) {
        if (h.future.length === 0) return;
        const next = h.future.shift()!;
        h.past = [...h.past, next].slice(-MAX_HISTORY);
        suppressNext = true;
        setNativeValue(el, next);
      } else {
        if (h.past.length <= 1) return;
        const current = h.past.pop()!;
        h.future = [current, ...h.future];
        const prev = h.past[h.past.length - 1];
        suppressNext = true;
        setNativeValue(el, prev);
      }
    };

    // Capture phase so we intercept before React's synthetic events
    window.addEventListener("input", onInput, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("input", onInput, true);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);
}
