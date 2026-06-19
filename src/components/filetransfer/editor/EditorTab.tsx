import { useEffect, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { sftpReadFile, sftpWriteFile, type EditorReadError } from "@/services/sftp";
import { useSftpSettingsStore } from "@/stores/sftpSettingsStore";
import { useEditorStore, type EditorDoc } from "@/stores/editorStore";
import { languageForPath } from "./languageForPath";
import { IconBtn } from "@/components/filetransfer/FilePane";

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
  const maxBytes = useSftpSettingsStore((s) => s.editorMaxBytes);
  const setDirty = useEditorStore((s) => s.setDirty);
  const setDocAutoSave = useEditorStore((s) => s.setDocAutoSave);

  const [content, setContent] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<EditorReadError | string | null>(null);
  const [saving, setSaving] = useState(false);
  const lastSaved = useRef<string>("");

  const ext = languageForPath(doc.path);
  const extensions = ext ? [ext] : [];

  const doSave = async (text: string) => {
    setSaving(true);
    try {
      await sftpWriteFile(doc.sftpId, doc.path, text);
      lastSaved.current = text;
      setDirty(doc.id, false);
      setError(null);
    } catch (e) {
      setError(typeof e === "string" ? e : "save failed");
    } finally {
      setSaving(false);
    }
  };

  const saverRef = useRef(createDebouncedSaver(doSave, 1000));

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setLoading(true);
    sftpReadFile(doc.sftpId, doc.path, maxBytes)
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
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
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
  if (loading) return <div className="p-4 text-sm" style={{ color: "var(--t-text-dim)" }}>Loading…</div>;

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
        <label
          className="ml-auto flex items-center gap-1 shrink-0 cursor-pointer select-none"
          style={{ color: "var(--t-text-secondary)" }}
        >
          <input
            type="checkbox"
            checked={doc.autoSave}
            onChange={(e) => setDocAutoSave(doc.id, e.target.checked)}
            className="cursor-pointer"
          />
          Auto-save
        </label>
        {/* Save button — styled like FilePane toolbar buttons */}
        <IconBtn
          icon={saving ? "lucide:loader-circle" : "lucide:save"}
          title={saving ? "Saving…" : "Save (Ctrl+S)"}
          onClick={() => { if (!saving) void doSave(content); }}
        />
      </div>
      {/* Editor */}
      <div className="min-h-0 flex-1 overflow-auto">
        <CodeMirror value={content} extensions={extensions} onChange={onChange} height="100%" />
      </div>
    </div>
  );
}

function EditorError({
  error,
}: {
  error: EditorReadError | string;
  sftpId: string;
  path: string;
}) {
  let msg = "Failed to open file.";
  if (typeof error !== "string") {
    if (error.kind === "too_large")
      msg = `File too large (${error.size} bytes, limit ${error.limit}). Download it instead.`;
    else if (error.kind === "binary")
      msg = "Binary file — can't edit. Download it instead.";
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
