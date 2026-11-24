import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import CodeMirror from "@uiw/react-codemirror";
import type { EditorReadError } from "@/services/sftp";
import { useEditorStore, type EditorDoc } from "@/stores/editorStore";
import { languageForPath } from "./languageForPath";
import { useCmTheme } from "./useCmTheme";
import { IconBtn } from "@/components/filetransfer/FilePane";
import { Toggle } from "@/components/shared/Toggle";
import { ImageView } from "./ImageView";
import { useReadOnlyTip } from "@/services/deviceReadOnly";
import { ReadOnlyBadge } from "@/components/shared/ReadOnlyBadge";
import { useEditorDoc } from "./useEditorDoc";

export function EditorTab({ doc }: { doc: EditorDoc }) {
  const { t } = useTranslation();
  const setDocAutoSave = useEditorStore((s) => s.setDocAutoSave);
  const ed = useEditorDoc(doc);
  const readOnlyTip = useReadOnlyTip(doc.readOnly, doc.hostLabel);

  if (ed.asImage) return <ImageView doc={doc} onNotImage={() => ed.setAsImage(false)} />;
  if (ed.error) return <EditorError error={ed.error} />;
  if (ed.loading) return <EditorLoading />;

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
        {readOnlyTip && <ReadOnlyBadge tip={readOnlyTip} className="ml-auto" />}
        {/* Auto-save toggle */}
        {!readOnlyTip && <div
          className="ml-auto flex items-center gap-2 shrink-0 select-none"
          style={{ color: "var(--t-text-secondary)" }}
        >
          <span>{t("fileTransfer.editor.tab.autoSave")}</span>
          <Toggle checked={doc.autoSave} onChange={(v) => setDocAutoSave(doc.id, v)} />
        </div>}
        {/* Save button — styled like FilePane toolbar buttons */}
        <IconBtn
          icon={ed.saving ? "lucide:loader-circle" : "lucide:save"}
          title={readOnlyTip ?? (ed.saving ? t("common.state.saving") : t("fileTransfer.editor.common.saveCtrlS"))}
          disabled={!!readOnlyTip}
          onClick={() => { if (!ed.saving) void ed.save(); }}
        />
      </div>
      <SaveErrorBanner ed={ed} />
      <EditorText doc={doc} ed={ed} readOnly={!!readOnlyTip} />
    </div>
  );
}

type EditorDocState = ReturnType<typeof useEditorDoc>;

export function EditorLoading() {
  const { t } = useTranslation();
  return <div className="p-4 text-sm" style={{ color: "var(--t-text-dim)" }}>{t("common.state.loading")}</div>;
}

/** Non-destructive: editing continues underneath. */
export function SaveErrorBanner({ ed, className = "px-2 py-1 text-xs" }: { ed: EditorDocState; className?: string }) {
  const { t } = useTranslation();
  if (!ed.saveError) return null;
  return (
    <div
      data-editor-save-error
      className={`flex items-center gap-2 shrink-0 border-b ${className}`}
      style={{
        borderColor: "var(--t-border)",
        background: "color-mix(in srgb, var(--t-status-error) 12%, transparent)",
        color: "var(--t-status-error)",
      }}
    >
      <span className="shrink-0">⚠</span>
      <span className="truncate min-w-0">{t("fileTransfer.editor.tab.saveFailedReason", { error: ed.saveError })}</span>
      <button
        className="ml-auto shrink-0 px-1 rounded"
        title={t("fileTransfer.editor.common.retrySave")}
        onClick={() => { if (!ed.saving) void ed.save(); }}
      >
        {t("fileTransfer.editor.common.retry")}
      </button>
      <button
        className="shrink-0 px-1 rounded"
        title={t("fileTransfer.editor.common.dismiss")}
        onClick={ed.dismissSaveError}
      >
        ×
      </button>
    </div>
  );
}

export function EditorText({ doc, ed, readOnly }: { doc: EditorDoc; ed: EditorDocState; readOnly: boolean }) {
  const themeExt = useCmTheme();
  const ext = languageForPath(doc.path);
  const extensions = useMemo(() => [...themeExt, ...(ext ? [ext] : [])], [themeExt, ext]);
  return (
    <div className="relative min-h-0 flex-1">
      <CodeMirror
        className="absolute inset-0"
        value={ed.content}
        extensions={extensions}
        onChange={ed.onChange}
        readOnly={readOnly}
        height="100%"
        theme="none"
      />
    </div>
  );
}

export function EditorError({ error }: { error: EditorReadError | string }) {
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
