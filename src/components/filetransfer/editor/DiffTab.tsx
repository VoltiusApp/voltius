import { useEffect, useRef, useState } from "react";
import { MergeView } from "@codemirror/merge";
import { EditorView } from "@codemirror/view";
import { readEditorFile, writeEditorFile } from "@/services/sftp";
import { useSftpSettingsStore } from "@/stores/sftpSettingsStore";
import { useThemeStore } from "@/stores/themeStore";
import { useEditorStore, type DiffDoc, type DiffSide } from "@/stores/editorStore";
import { languageForPath } from "./languageForPath";
import { shouldHandleSaveKey } from "./editorSaveKey";
import { sideMeta, type DiffPane } from "./diffSave";
import { cmTheme } from "./cmTheme";
import { IconBtn } from "@/components/filetransfer/FilePane";
import { attachDiffRibbons, type DiffRibbonsHandle } from "./diffRibbons";
import { activeChunkIndex, nextChunkIndex, prevChunkIndex } from "./diffChunks";
import "./diffRibbons.css";

export function DiffTab({ doc }: { doc: DiffDoc }) {
  const maxBytes = useSftpSettingsStore((s) => s.editorMaxBytes);
  const setDiffDirty = useEditorStore((s) => s.setDiffDirty);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mergeRef = useRef<MergeView | null>(null);
  const ribbonsRef = useRef<DiffRibbonsHandle | null>(null);
  const [nav, setNav] = useState<{ count: number; index: number }>({ count: 0, index: 0 });
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState<{ a: string; b: string } | null>(null);
  const activeThemeId = useThemeStore((s) => s.activeThemeId);
  const getActiveTheme = useThemeStore((s) => s.getActiveTheme);

  // Per-side baselines (last saved) and live content survive view re-creation.
  const baseA = useRef("");
  const baseB = useRef("");
  const contentA = useRef("");
  const contentB = useRef("");
  const [dirtyA, setDirtyA] = useState(false);
  const [dirtyB, setDirtyB] = useState(false);
  const [savingA, setSavingA] = useState(false);
  const [savingB, setSavingB] = useState(false);
  const [errorA, setErrorA] = useState<string | null>(null);
  const [errorB, setErrorB] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    setReady(null);
    Promise.all([
      readEditorFile(doc.left.sftpId, doc.left.path, maxBytes),
      readEditorFile(doc.right.sftpId, doc.right.path, maxBytes),
    ])
      .then(([a, b]) => {
        if (cancelled) return;
        baseA.current = a.content;
        baseB.current = b.content;
        contentA.current = a.content;
        contentB.current = b.content;
        setDirtyA(false);
        setDirtyB(false);
        setReady({ a: a.content, b: b.content });
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load one or both files for diff.");
      });
    return () => {
      cancelled = true;
    };
  }, [doc.id, maxBytes, doc.left.sftpId, doc.left.path, doc.right.sftpId, doc.right.path]);

  const doSave = async (side: DiffPane) => {
    const view = side === "a" ? mergeRef.current?.a : mergeRef.current?.b;
    if (!view) return;
    const text = view.state.doc.toString();
    const meta = sideMeta(doc, side);
    const setSaving = side === "a" ? setSavingA : setSavingB;
    const setErr = side === "a" ? setErrorA : setErrorB;
    const setDirty = side === "a" ? setDirtyA : setDirtyB;
    const baseRef = side === "a" ? baseA : baseB;
    setSaving(true);
    try {
      await writeEditorFile(meta.sftpId, meta.path, text);
      baseRef.current = text;
      setDirty(false);
      setErr(null);
    } catch (e) {
      setErr(typeof e === "string" ? e : "Save failed");
    } finally {
      setSaving(false);
    }
  };
  const saveRef = useRef(doSave);
  saveRef.current = doSave;

  // Report combined dirty to the store so the tab strip / close guard can react.
  useEffect(() => {
    setDiffDirty(doc.id, dirtyA || dirtyB);
  }, [dirtyA, dirtyB, doc.id, setDiffDirty]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isActive = useEditorStore.getState().activeTabId === doc.id;
      if (!shouldHandleSaveKey(e, isActive)) return;
      e.preventDefault();
      const mv = mergeRef.current;
      if (!mv) return;
      if (mv.a.state.doc.toString() !== baseA.current) void saveRef.current("a");
      if (mv.b.state.doc.toString() !== baseB.current) void saveRef.current("b");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doc.id]);

  useEffect(() => {
    if (!ready || !hostRef.current) return;
    const theme = cmTheme(getActiveTheme());
    const langA = languageForPath(doc.left.path);
    const langB = languageForPath(doc.right.path);
    const track = (side: DiffPane) =>
      EditorView.updateListener.of((u) => {
        ribbonsRef.current?.remeasure();
        const tops = ribbonsRef.current?.chunkTops() ?? [];
        const host = hostRef.current;
        const mid = host ? host.scrollTop + host.clientHeight / 2 : 0;
        const count = tops.length;
        const index = Math.max(0, activeChunkIndex(tops, mid));
        setNav((prev) =>
          prev.count === count && prev.index === index ? prev : { count, index },
        );
        if (!u.docChanged) return;
        const text = u.state.doc.toString();
        if (side === "a") {
          contentA.current = text;
          setDirtyA(text !== baseA.current);
        } else {
          contentB.current = text;
          setDirtyB(text !== baseB.current);
        }
      });
    const view = new MergeView({
      a: {
        doc: contentA.current,
        extensions: [track("a"), ...theme, ...(langA ? [langA] : [])],
      },
      b: {
        doc: contentB.current,
        extensions: [track("b"), ...theme, ...(langB ? [langB] : [])],
      },
      collapseUnchanged: { margin: 3, minSize: 6 },
      parent: hostRef.current,
    });
    mergeRef.current = view;
    ribbonsRef.current = attachDiffRibbons(view, hostRef.current);
    const onScroll = () => {
      const tops = ribbonsRef.current?.chunkTops() ?? [];
      const host = hostRef.current;
      const mid = host ? host.scrollTop + host.clientHeight / 2 : 0;
      const count = tops.length;
      const index = Math.max(0, activeChunkIndex(tops, mid));
      setNav((prev) =>
        prev.count === count && prev.index === index ? prev : { count, index },
      );
    };
    hostRef.current.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      hostRef.current?.removeEventListener("scroll", onScroll);
      ribbonsRef.current?.destroy();
      ribbonsRef.current = null;
      view.destroy();
      mergeRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, doc.left.path, doc.right.path, activeThemeId]);

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

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar: independent save controls for each editable side. */}
      <div
        className="flex items-center gap-2 shrink-0 px-2 py-1 border-b text-xs"
        style={{ borderColor: "var(--t-border)", background: "var(--t-bg-card)" }}
      >
        <SideControls meta={doc.left} dirty={dirtyA} saving={savingA} onSave={() => void doSave("a")} />
        <div className="flex-1" />
        {nav.count > 0 && (
          <div className="flex shrink-0 items-center gap-1" style={{ color: "var(--t-text-dim)" }}>
            <IconBtn
              icon="lucide:chevron-up"
              title="Previous change"
              onClick={() => {
                const host = hostRef.current;
                const tops = ribbonsRef.current?.chunkTops() ?? [];
                const i = prevChunkIndex(tops, host ? host.scrollTop : 0);
                if (i !== null) ribbonsRef.current?.scrollToChunk(i);
              }}
            />
            <span className="tabular-nums">{nav.index + 1} / {nav.count}</span>
            <IconBtn
              icon="lucide:chevron-down"
              title="Next change"
              onClick={() => {
                const host = hostRef.current;
                const tops = ribbonsRef.current?.chunkTops() ?? [];
                const i = nextChunkIndex(tops, host ? host.scrollTop : 0);
                if (i !== null) ribbonsRef.current?.scrollToChunk(i);
              }}
            />
          </div>
        )}
        <div className="flex-1" />
        <SideControls meta={doc.right} dirty={dirtyB} saving={savingB} onSave={() => void doSave("b")} alignEnd />
      </div>
      {(errorA || errorB) && (
        <div className="flex shrink-0 gap-2 border-b" style={{ borderColor: "var(--t-border)" }}>
          {errorA && <SaveErrorBanner label={doc.left.path} msg={errorA} onRetry={() => void doSave("a")} onDismiss={() => setErrorA(null)} />}
          {errorB && <SaveErrorBanner label={doc.right.path} msg={errorB} onRetry={() => void doSave("b")} onDismiss={() => setErrorB(null)} />}
        </div>
      )}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-auto" />
    </div>
  );
}

function SideControls({
  meta,
  dirty,
  saving,
  onSave,
  alignEnd,
}: {
  meta: DiffSide;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  alignEnd?: boolean;
}) {
  return (
    <div className={`flex min-w-0 items-center gap-1 ${alignEnd ? "flex-row-reverse" : ""}`}>
      <IconBtn
        icon={saving ? "lucide:loader-circle" : "lucide:save"}
        title={saving ? "Saving…" : "Save (Ctrl+S)"}
        onClick={() => { if (!saving) onSave(); }}
      />
      {dirty && <span className="shrink-0" style={{ color: "var(--t-accent-warn, #f59e0b)" }}>●</span>}
      <span className="truncate min-w-0" style={{ color: "var(--t-text-dim)" }}>
        {meta.hostLabel}:{meta.path}
      </span>
    </div>
  );
}

function SaveErrorBanner({
  label,
  msg,
  onRetry,
  onDismiss,
}: {
  label: string;
  msg: string;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="flex flex-1 items-center gap-2 px-2 py-1 text-xs"
      style={{
        background: "color-mix(in srgb, var(--t-status-error) 12%, transparent)",
        color: "var(--t-status-error)",
      }}
    >
      <span className="shrink-0">⚠</span>
      <span className="truncate min-w-0">{label}: {msg}</span>
      <button className="ml-auto shrink-0 px-1 rounded" title="Retry save" onClick={onRetry}>Retry</button>
      <button className="shrink-0 px-1 rounded" title="Dismiss" onClick={onDismiss}>×</button>
    </div>
  );
}
