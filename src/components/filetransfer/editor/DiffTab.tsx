import { useEffect, useRef, useState } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { sftpReadFile } from "@/services/sftp";
import { useSftpSettingsStore } from "@/stores/sftpSettingsStore";
import { type DiffDoc } from "@/stores/editorStore";
import { languageForPath } from "./languageForPath";

export function DiffTab({ doc }: { doc: DiffDoc }) {
  const maxBytes = useSftpSettingsStore((s) => s.editorMaxBytes);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<{ a: string; b: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setReady(null);
    Promise.all([
      sftpReadFile(doc.left.sftpId, doc.left.path, maxBytes),
      sftpReadFile(doc.right.sftpId, doc.right.path, maxBytes),
    ])
      .then(([a, b]) => {
        if (!cancelled) setReady({ a: a.content, b: b.content });
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load one or both files for diff.");
      });
    return () => {
      cancelled = true;
    };
  }, [doc.id, maxBytes, doc.left.sftpId, doc.left.path, doc.right.sftpId, doc.right.path]);

  useEffect(() => {
    if (!ready || !hostRef.current) return;
    const readOnly = EditorState.readOnly.of(true);
    const notEditable = EditorView.editable.of(false);
    const langA = languageForPath(doc.left.path);
    const langB = languageForPath(doc.right.path);
    const view = new MergeView({
      a: {
        doc: ready.a,
        extensions: [readOnly, notEditable, ...(langA ? [langA] : [])],
      },
      b: {
        doc: ready.b,
        extensions: [readOnly, notEditable, ...(langB ? [langB] : [])],
      },
      parent: hostRef.current,
    });
    return () => view.destroy();
  }, [ready, doc.left.path, doc.right.path]);

  if (error)
    return (
      <div className="p-4 text-sm" style={{ color: "var(--t-error, #ef4444)" }}>
        {error}
      </div>
    );
  if (!ready)
    return (
      <div className="p-4 text-sm" style={{ color: "var(--t-text-dim)" }}>
        Loading diff…
      </div>
    );
  return <div ref={hostRef} className="h-full overflow-auto" />;
}
