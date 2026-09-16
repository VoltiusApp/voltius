import { useCallback, useEffect, useRef, useState } from "react";
import { useAutosave, type SaveState } from "@/hooks/useAutosave";
import { normalizeNotes, sameNotes } from "./notesText";

export const NOTES_SAVE_DELAY_MS = 1500;

export interface NotesDraft {
  draft: string;
  setDraft: (value: string) => void;
  conflict: boolean;
  reload: () => void;
  keepMine: () => void;
  flush: () => void;
  error: string | null;
  retry: () => void;
  saveState: SaveState;
}

export function useNotesDraft(stored: string | undefined, save: (notes: string | undefined) => Promise<void>): NotesDraft {
  const storedText = stored ?? "";
  const [draft, setDraftState] = useState(storedText);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baseRef = useRef(storedText);
  const pendingRef = useRef<string | null>(null);
  const conflictRef = useRef(false);
  const saveRef = useRef(save);
  saveRef.current = save;
  const inFlightRef = useRef<Promise<void> | null>(null);
  const resaveRef = useRef(false);

  const needsSave = () => !conflictRef.current && !sameNotes(draftRef.current, baseRef.current);

  const performSave = useCallback(async () => {
    if (!needsSave()) return;
    const value = draftRef.current;
    pendingRef.current = value;
    try {
      await saveRef.current(normalizeNotes(value));
      baseRef.current = value;
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      pendingRef.current = null;
    }
  }, []);

  const onSave = useCallback(async () => {
    if (inFlightRef.current) {
      resaveRef.current = true;
      return inFlightRef.current;
    }
    const run = (async () => {
      await performSave();
      while (resaveRef.current) {
        resaveRef.current = false;
        if (needsSave()) await performSave();
      }
      inFlightRef.current = null;
    })();
    inFlightRef.current = run;
    await run;
  }, [performSave]);

  const { schedule, markDirty, flush, saveState } = useAutosave({
    delay: NOTES_SAVE_DELAY_MS,
    canSave: needsSave,
    onSave,
  });

  const flushRef = useRef(flush);
  flushRef.current = flush;
  // Declared before the schedule effect: unmount cleanups run in order, so this flushes before the timer is cleared.
  useEffect(() => () => flushRef.current(), []);
  useEffect(() => schedule(), [draft, schedule]);

  useEffect(() => {
    if (sameNotes(draftRef.current, storedText)) {
      baseRef.current = storedText;
      conflictRef.current = false;
      setConflict(false);
      return;
    }
    if (sameNotes(storedText, baseRef.current)) return;
    if (pendingRef.current !== null && sameNotes(storedText, pendingRef.current)) {
      baseRef.current = storedText;
      return;
    }
    if (sameNotes(draftRef.current, baseRef.current)) {
      baseRef.current = storedText;
      setDraftState(storedText);
      return;
    }
    conflictRef.current = true;
    setConflict(true);
    schedule();
  }, [storedText, schedule]);

  const setDraft = useCallback((value: string) => {
    markDirty();
    setDraftState(value);
  }, [markDirty]);

  const resolveConflict = () => {
    baseRef.current = storedText;
    conflictRef.current = false;
    setConflict(false);
  };

  const reload = () => {
    resolveConflict();
    setDraftState(storedText);
    setError(null);
  };

  const keepMine = () => {
    resolveConflict();
    markDirty();
    schedule();
  };

  const retry = () => {
    if (sameNotes(draftRef.current, baseRef.current)) {
      setError(null);
      return;
    }
    markDirty();
    schedule();
    flush();
  };

  let effectiveSaveState: SaveState = saveState;
  if (error || conflict) {
    effectiveSaveState = "dirty";
  } else if (saveState === "dirty" && inFlightRef.current === null && sameNotes(draft, baseRef.current)) {
    effectiveSaveState = "idle";
  }

  return { draft, setDraft, conflict, reload, keepMine, flush, error, retry, saveState: effectiveSaveState };
}
