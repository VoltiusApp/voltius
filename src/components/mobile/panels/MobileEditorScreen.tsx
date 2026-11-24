import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useEditorStore, type EditorDoc } from "@/stores/editorStore";
import { useEditorDoc } from "@/components/filetransfer/editor/useEditorDoc";
import { EditorError, EditorLoading, EditorText, SaveErrorBanner } from "@/components/filetransfer/editor/EditorTab";
import { useReadOnlyTip } from "@/services/deviceReadOnly";
import { baseName, parentDir } from "@/components/filetransfer/moveTargetCore";
import { useBackInterceptor } from "@/hooks/useBackInterceptor";
import { Toggle } from "@/components/shared/Toggle";
import { ReadOnlyBadge } from "@/components/shared/ReadOnlyBadge";
import MobilePanelHeader from "./MobilePanelHeader";
import { SheetItem } from "./MobileSftpPane";
import BottomSheet from "../sheets/BottomSheet";

/** Full-screen text editor over the SFTP screen; `active` gates its Back handler while the tab is hidden. */
export default function MobileEditorScreen({ doc, active }: { doc: EditorDoc; active: boolean }) {
  const { t } = useTranslation();
  const closeTab = useEditorStore((s) => s.closeTab);
  const setDocAutoSave = useEditorStore((s) => s.setDocAutoSave);
  const ed = useEditorDoc(doc);
  const readOnlyTip = useReadOnlyTip(doc.readOnly, doc.hostLabel);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const editable = !readOnlyTip && !ed.asImage && !ed.loading && !ed.error;

  const close = () => closeTab(doc.id);
  const requestClose = async () => {
    if (!doc.dirty || !editable) return close();
    if (doc.autoSave) {
      if (await ed.save()) close();
      return;
    }
    setConfirmDiscard(true);
  };
  useBackInterceptor(active, () => void requestClose());

  const body = ed.asImage
    ? <EditorError error={{ kind: "binary" }} />
    : ed.error ? <EditorError error={ed.error} />
    : ed.loading ? <EditorLoading />
    : (
      <>
        <div className="shrink-0 flex items-center gap-3 px-4 h-11 border-b text-sm"
          style={{ borderColor: "var(--t-border)", color: "var(--t-text-secondary)" }}>
          {readOnlyTip ? <ReadOnlyBadge tip={readOnlyTip} /> : (
            <label className="ml-auto flex items-center gap-3 select-none">
              <span>{t("fileTransfer.editor.tab.autoSave")}</span>
              <Toggle checked={doc.autoSave} onChange={(v) => setDocAutoSave(doc.id, v)} aria-label={t("fileTransfer.editor.tab.autoSave")} />
            </label>
          )}
        </div>
        <SaveErrorBanner ed={ed} className="px-4 py-2 text-sm" />
        <EditorText doc={doc} ed={ed} readOnly={!!readOnlyTip} />
      </>
    );

  return (
    <div data-mobile-editor className="absolute inset-0 z-40 flex flex-col bg-(--t-bg-base)">
      <MobilePanelHeader
        title={baseName(doc.path)}
        sessionName={`${doc.hostLabel} · ${parentDir(doc.path)}`}
        onBack={() => void requestClose()}
        right={editable ? (
          <button data-mobile-editor-save disabled={ed.saving || !doc.dirty} onClick={() => void ed.save()}
            aria-label={t("common.action.save")} title={t("common.action.save")}
            className="vt-icon-btn disabled:opacity-40"
            style={{ color: doc.dirty ? "var(--t-accent)" : "var(--t-text-dim)" }}>
            <Icon icon={ed.saving ? "lucide:loader-circle" : "lucide:save"} width={22} className={ed.saving ? "animate-spin" : undefined} />
          </button>
        ) : undefined}
      />
      <div className="flex-1 min-h-0 flex flex-col text-base">{body}</div>
      {confirmDiscard && (
        <BottomSheet title={t("fileTransfer.editor.tabStrip.discardTitle")} onClose={() => setConfirmDiscard(false)}>
          <SheetItem attr="editor-save" icon="lucide:save" label={t("common.action.save")}
            onTap={() => { setConfirmDiscard(false); void ed.save().then((ok) => { if (ok) close(); }); }} />
          <SheetItem attr="editor-discard" icon="lucide:trash-2" label={t("fileTransfer.editor.tabStrip.discard")} danger onTap={close} />
        </BottomSheet>
      )}
    </div>
  );
}
