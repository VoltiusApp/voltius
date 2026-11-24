import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { readEditorFile, writeEditorFile, type EditorReadError } from "@/services/sftp";
import { useSftpSettingsStore } from "@/stores/sftpSettingsStore";
import { useEditorStore, type EditorDoc } from "@/stores/editorStore";
import { shouldHandleSaveKey } from "./editorSaveKey";
import { looksLikeImage } from "./tabIcon";

export function createDebouncedSaver(
  save: (content: string) => Promise<unknown>,
  delayMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: string | null = null;
  const run = () => {
    timer = null;
    const c = pending;
    pending = null;
    if (c !== null) void save(c);
  };
  return {
    schedule(content: string) {
      pending = content;
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, delayMs);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        run();
      }
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

/** Loads one editor document and saves it (button, Ctrl+S, auto-save); shared by the desktop tab and the mobile screen. */
export function useEditorDoc(doc: EditorDoc) {
  const { t } = useTranslation();
  const maxBytes = useSftpSettingsStore((s) => s.editorMaxBytes);
  const setDirty = useEditorStore((s) => s.setDirty);

  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<EditorReadError | string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [asImage, setAsImage] = useState(() => doc.image === true || looksLikeImage(doc.path));
  const lastSaved = useRef<string>("");

  const doSave = async (text: string): Promise<boolean> => {
    setSaving(true);
    try {
      await writeEditorFile(doc.sftpId, doc.path, text);
      lastSaved.current = text;
      setDirty(doc.id, false);
      setSaveError(null);
      return true;
    } catch (e) {
      setSaveError(typeof e === "string" ? e : t("fileTransfer.editor.common.saveFailed"));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const saverRef = useRef(createDebouncedSaver(doSave, 1000));

  useEffect(() => {
    if (asImage) return;
    let cancelled = false;
    setError(null);
    setSaveError(null);
    setLoading(true);
    readEditorFile(doc.sftpId, doc.path, maxBytes)
      .then((f) => {
        if (cancelled) return;
        setContent(f.content);
        lastSaved.current = f.content;
        setLoading(false);
      })
      .catch((e: EditorReadError) => {
        if (cancelled) return;
        if (e.kind === "image") setAsImage(true);
        else setError(e);
        setLoading(false);
      });
    const saver = saverRef.current;
    return () => {
      cancelled = true;
      saver.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id, asImage]);

  const onChange = (next: string) => {
    setContent(next);
    setDirty(doc.id, next !== lastSaved.current);
    if (doc.autoSave) saverRef.current.schedule(next);
  };

  const save = () => {
    saverRef.current.cancel();
    return doSave(content);
  };

  useEffect(() => {
    // Without loaded text the buffer is empty, and saving it would wipe the file.
    if (asImage || loading || error || doc.readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      // Every mounted editor shares the window; only the active one saves.
      const isActive = useEditorStore.getState().activeTabId === doc.id;
      if (shouldHandleSaveKey(e, isActive)) {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, asImage, loading, error, doc.readOnly]);

  return {
    content, loading, error, saveError, saving, asImage, setAsImage, onChange, save,
    dismissSaveError: () => setSaveError(null),
  };
}
