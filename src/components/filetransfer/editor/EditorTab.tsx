import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import CodeMirror from "@uiw/react-codemirror";
import { readEditorFile, writeEditorFile, type EditorReadError } from "@/services/sftp";
import { useSftpSettingsStore } from "@/stores/sftpSettingsStore";
import { useEditorStore, type EditorDoc } from "@/stores/editorStore";
import { languageForPath } from "./languageForPath";
import { shouldHandleSaveKey } from "./editorSaveKey";
import { useCmTheme } from "./useCmTheme";
import { IconBtn } from "@/components/filetransfer/FilePane";
import { Toggle } from "@/components/shared/Toggle";

export function createDebouncedSaver(
  save: (content: string) => Promise<void>,
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

export function EditorTab({ doc }: { doc: EditorDoc }) {
  const { t } = useTranslation();
  const maxBytes = useSftpSettingsStore((s) => s.editorMaxBytes);
  const setDirty = useEditorStore((s) => s.setDirty);
  const setDocAutoSave = useEditorStore((s) => s.setDocAutoSave);

  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<EditorReadError | string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lastSaved = useRef<string>("");

  const themeExt = useCmTheme();

  const ext = languageForPath(doc.path);
  const extensions = useMemo(
    () => [...themeExt, ...(ext ? [ext] : [])],
    [themeExt, ext],
  );

  const doSave = async (text: string) => {
    setSaving(true);
    try {
      await writeEditorFile(doc.sftpId, doc.path, text);
      lastSaved.current = text;
      setDirty(doc.id, false);
      setSaveError(null);
    } catch (e) {
      setSaveError(typeof e === "string" ? e : t("fileTransfer.editor.common.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const saverRef = useRef(createDebouncedSaver(doSave, 1000));

  useEffect(() => {
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
        setError(e);
        setLoading(false);
      });
    const saver = saverRef.current;
    return () => {
      cancelled = true;
      saver.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);

  const onChange = (next: string) => {
    setContent(next);
    setDirty(doc.id, next !== lastSaved.current);
    if (doc.autoSave) saverRef.current.schedule(next);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Every mounted EditorTab shares the window; only the active tab saves.
      const isActive = useEditorStore.getState().activeTabId === doc.id;
      if (shouldHandleSaveKey(e, isActive)) {
        e.preventDefault();
        saverRef.current.cancel();
        void doSave(content);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  if (error) return <EditorError error={error} sftpId={doc.sftpId} path={doc.path} />;
  if (loading) return <div className="p-4 text-sm" style={{ color: "var(--t-text-dim)" }}>{t("common.state.loading")}</div>;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div
        className="flex items-center gap-2 shrink-0 px-2 py-1 border-b text-xs"
        style={{ borderColor: "var(--t-border)", background: "var(--t-bg-card)" }}
      >
        <span className="truncate min-w-0" style={{ color: "var(--t-text-dim)" }}>
          {doc.hostLabel}:{doc.path}
        </span>
        {doc.dirty && (
          <span className="shrink-0" style={{ color: "var(--t-accent-warn, #f59e0b)" }}>●</span>
        )}
        {/* Auto-save toggle */}
        <div
          className="ml-auto flex items-center gap-2 shrink-0 select-none"
          style={{ color: "var(--t-text-secondary)" }}
        >
          <span>{t("fileTransfer.editor.tab.autoSave")}</span>
          <Toggle checked={doc.autoSave} onChange={(v) => setDocAutoSave(doc.id, v)} />
        </div>
        {/* Save button — styled like FilePane toolbar buttons */}
        <IconBtn
          icon={saving ? "lucide:loader-circle" : "lucide:save"}
          title={saving ? t("common.state.saving") : t("fileTransfer.editor.common.saveCtrlS")}
          onClick={() => { if (!saving) void doSave(content); }}
        />
      </div>
      {/* Save error banner — non-destructive; editing continues underneath */}
      {saveError && (
        <div
          className="flex items-center gap-2 shrink-0 px-2 py-1 border-b text-xs"
          style={{
            borderColor: "var(--t-border)",
            background: "color-mix(in srgb, var(--t-status-error) 12%, transparent)",
            color: "var(--t-status-error)",
          }}
        >
          <span className="shrink-0">⚠</span>
          <span className="truncate min-w-0">{t("fileTransfer.editor.tab.saveFailedReason", { error: saveError })}</span>
          <button
            className="ml-auto shrink-0 px-1 rounded"
            title={t("fileTransfer.editor.common.retrySave")}
            onClick={() => { if (!saving) void doSave(content); }}
          >
            {t("fileTransfer.editor.common.retry")}
          </button>
          <button
            className="shrink-0 px-1 rounded"
            title={t("fileTransfer.editor.common.dismiss")}
            onClick={() => setSaveError(null)}
          >
            ×
          </button>
        </div>
      )}
      {/* Editor */}
      <div className="min-h-0 flex-1 overflow-auto">
        <CodeMirror
          value={content}
          extensions={extensions}
          onChange={onChange}
          height="100%"
          theme="none"
        />
      </div>
    </div>
  );
}

function EditorError({
  error,
}: {
  error: EditorReadError | string;
  sftpId: string | null;
  path: string;
}) {
  const { t } = useTranslation();
  let msg = t("fileTransfer.editor.tab.error.default");
  if (typeof error !== "string") {
    if (error.kind === "too_large")
      msg = t("fileTransfer.editor.tab.error.tooLarge", { size: error.size, limit: error.limit });
    else if (error.kind === "binary")
      msg = t("fileTransfer.editor.tab.error.binary");
    else if (error.kind === "io")
      msg = error.message;
  } else {
    msg = error;
  }
  return (
    <div className="p-4 text-sm" style={{ color: "var(--t-error, #ef4444)" }}>
      {msg}
    </div>
  );
}
