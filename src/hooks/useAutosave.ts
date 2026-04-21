import { useCallback, useRef, useState } from "react";

export type SaveState = "idle" | "dirty" | "saving" | "saved";

const DEFAULT_DELAY = 600;
const SAVED_DISPLAY_MS = 2000;

export function useAutosave({
  onSave,
  canSave,
  delay = DEFAULT_DELAY,
}: {
  onSave: () => void | Promise<void>;
  canSave?: () => boolean;
  delay?: number;
}) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const canSaveRef = useRef(canSave);
  canSaveRef.current = canSave;

  const markDirty = useCallback(() => { dirtyRef.current = true; }, []);

  const markSaved = useCallback(() => {
    setSaveState("saved");
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaveState("idle"), SAVED_DISPLAY_MS);
  }, []);

  const runSave = useCallback(() => {
    setSaveState("saving");
    const result = onSaveRef.current();
    if (result instanceof Promise) result.then(markSaved, markSaved);
    else markSaved();
  }, [markSaved]);

  const schedule = useCallback((): (() => void) | undefined => {
    if (!dirtyRef.current) return undefined;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    if (canSaveRef.current && !canSaveRef.current()) return undefined;
    setSaveState("dirty");
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      runSave();
    }, delay);
    return () => {
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, [delay, runSave]);

  const flush = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      if (!canSaveRef.current || canSaveRef.current()) runSave();
    }
  }, [runSave]);

  const flushAndClose = useCallback((onClose: () => void) => {
    flush();
    onClose();
  }, [flush]);

  return { schedule, markDirty, flushAndClose, flush, saveState };
}
