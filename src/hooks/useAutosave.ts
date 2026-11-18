import { useCallback, useEffect, useRef, useState } from "react";

/** A text field has the keyboard: saving now re-renders the list behind the form and drops focus. */
function isTyping(): boolean {
  const el = document.activeElement;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

export type SaveState = "idle" | "dirty" | "saving" | "saved";

const DEFAULT_DELAY = 600;
const SAVED_DISPLAY_MS = 2000;

export function useAutosave({
  onSave,
  canSave,
  readOnly = false,
  delay = DEFAULT_DELAY,
  flushOnUnmount = false,
}: {
  onSave: () => void | Promise<void>;
  canSave?: () => boolean;
  readOnly?: boolean;
  delay?: number;
  /** Save a pending edit when the form unmounts. The mobile edit screens can be popped
   *  by the system Back without going through the form's close, which would otherwise
   *  drop the last debounce window of typing. */
  flushOnUnmount?: boolean;
}) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // The user changed something autosave cannot persist yet (canSave() is false), so
  // leaving now would lose it. Mobile edit screens confirm a discard while it is set.
  const [blocked, setBlocked] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const canSaveRef = useRef(canSave);
  canSaveRef.current = readOnly ? () => false : canSave;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const pendingRef = useRef(false);
  // The debounce elapsed while a text field had focus: the save waits for it to lose focus.
  const deferredRef = useRef(false);

  const markDirty = useCallback(() => { dirtyRef.current = true; }, []);

  const markSaved = useCallback(() => {
    setSaveState("saved");
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaveState("idle"), SAVED_DISPLAY_MS);
  }, []);

  const runSave = useCallback(() => {
    pendingRef.current = false;
    deferredRef.current = false;
    setSaveState("saving");
    const result = onSaveRef.current();
    if (result instanceof Promise) result.then(markSaved, markSaved);
    else markSaved();
  }, [markSaved]);

  const schedule = useCallback((): (() => void) | undefined => {
    if (!dirtyRef.current) return undefined;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const savable = !canSaveRef.current || canSaveRef.current();
    pendingRef.current = savable;
    setBlocked(!savable && !readOnlyRef.current);
    if (!savable) return undefined;
    setSaveState("dirty");
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (isTyping()) {
        deferredRef.current = true;
        return;
      }
      runSave();
    }, delay);
    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [delay, runSave]);

  const flush = useCallback(() => {
    if (timerRef.current || deferredRef.current) {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      if (!canSaveRef.current || canSaveRef.current()) runSave();
    }
  }, [runSave]);

  // Save a deferred edit once focus has left every text field.
  useEffect(() => {
    const onFocusOut = () => {
      if (!deferredRef.current) return;
      setTimeout(() => {
        if (!deferredRef.current || isTyping()) return;
        if (!canSaveRef.current || canSaveRef.current()) runSave();
        else deferredRef.current = false;
      }, 0);
    };
    document.addEventListener("focusout", onFocusOut);
    return () => document.removeEventListener("focusout", onFocusOut);
  }, [runSave]);

  // The schedule effect's own cleanup clears the timer on unmount, so this goes by
  // pendingRef (scheduled and not yet saved) rather than by the timer.
  useEffect(() => {
    if (!flushOnUnmount) return undefined;
    return () => {
      if (pendingRef.current && (!canSaveRef.current || canSaveRef.current())) runSave();
    };
  }, [flushOnUnmount, runSave]);

  const flushAndClose = useCallback((onClose: () => void) => {
    flush();
    onClose();
  }, [flush]);

  return { schedule, markDirty, flushAndClose, flush, saveState, blocked };
}
