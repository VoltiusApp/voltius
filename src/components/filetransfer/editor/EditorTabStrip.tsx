import { Fragment, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { useEditorStore, type EditorTab } from "@/stores/editorStore";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { tabIcon } from "./tabIcon";
import { startTabDragGesture, useTabDragSemantic } from "./tabDrag";
import { fadeMask, useTabStripScroll } from "@/hooks/useTabStripScroll";

function tabLabel(t: EditorTab): string {
  return t.kind === "file"
    ? (t.path.split("/").pop() ?? t.path)
    : `${t.left.path.split("/").pop() ?? t.left.path} ↔ ${t.right.path.split("/").pop() ?? t.right.path}`;
}

export function EditorTabStrip() {
  const { t } = useTranslation();
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const setActiveTab = useEditorStore((s) => s.setActiveTab);
  const closeTab = useEditorStore((s) => s.closeTab);
  const [pendingClose, setPendingClose] = useState<string | null>(null);

  const drag = useTabDragSemantic();
  const reorderIndex = drag?.target?.kind === "reorder" ? drag.target.index : null;

  const tabStrip = useTabStripScroll(`${activeTabId}|${tabs.length}`);

  // Close immediately unless the tab has unsaved edits, in which case confirm.
  const requestClose = (id: string) => {
    const tab = tabs.find((t) => t.id === id);
    if (tab && tab.dirty) setPendingClose(id);
    else closeTab(id);
  };
  const pendingTab = pendingClose ? tabs.find((tab) => tab.id === pendingClose) : null;
  const pendingName = !pendingTab
    ? t("fileTransfer.editor.tabStrip.pendingNameFallback")
    : pendingTab.kind === "file"
      ? (pendingTab.path.split("/").pop() ?? pendingTab.path)
      : t("fileTransfer.editor.tabStrip.pendingNameDiffFallback");

  if (tabs.length === 0) return null;

  return (
    <div
      className="flex items-stretch text-xs shrink-0"
      style={{
        borderBottom: "1px solid var(--t-border)",
        background: "var(--t-bg-elevated)",
        minHeight: "34px",
      }}
    >
      {/* "Files" stays pinned as a folder icon; only the tab list scrolls. */}
      <button
        className="shrink-0 flex items-center justify-center px-3 transition-colors"
        title={t("fileTransfer.editor.tabStrip.filesTab")}
        style={{
          color: activeTabId === null ? "var(--t-accent)" : "var(--t-text-dim)",
          background: activeTabId === null ? "var(--t-bg-card)" : "transparent",
          borderTop: activeTabId === null ? "2px solid var(--t-accent)" : "2px solid transparent",
          borderRight: "1px solid var(--t-border)",
        }}
        onClick={() => setActiveTab(null)}
      >
        <Icon icon="lucide:folder" width={15} />
      </button>

      <div ref={tabStrip.ref} className="flex items-stretch min-w-0 overflow-x-auto scrollbar-none" style={fadeMask(tabStrip.overflow)}>
        {tabs.map((tab, i) => {
          const active = activeTabId === tab.id;
          const name = tabLabel(tab);
          const diffTarget = drag?.target?.kind === "diff" && drag.target.targetId === tab.id;
          return (
            <Fragment key={tab.id}>
              {reorderIndex === i && (
                <div className="shrink-0 self-stretch" style={{ width: 2, background: "var(--t-accent)" }} />
              )}
              <div
                data-strip-active={active}
                data-tab-id={tab.id}
                className="group relative flex items-center gap-1.5 shrink-0 pl-2.5 pr-1.5 cursor-pointer transition-colors"
                style={{
                  maxWidth: "200px",
                  color: active ? "var(--t-text)" : "var(--t-text-dim)",
                  background: active ? "var(--t-bg-card)" : "transparent",
                  borderTop: active ? "2px solid var(--t-accent)" : "2px solid transparent",
                  borderRight: "1px solid var(--t-border)",
                  boxShadow: diffTarget ? "inset 0 0 0 2px var(--t-accent)" : undefined,
                }}
                title={tab.kind === "diff" ? t("fileTransfer.editor.tabStrip.diffTitlePrefix", { name }) : name}
                onClick={() => setActiveTab(tab.id)}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  startTabDragGesture({
                    id: tab.id,
                    label: name,
                    canDiff: tab.kind === "file",
                    startX: e.clientX,
                    startY: e.clientY,
                  });
                }}
              >
                <Icon icon={tabIcon(tab)} width={14} className="shrink-0" style={{ opacity: 0.8 }} />
                {tab.dirty && (
                  <span
                    className="shrink-0"
                    style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--t-accent-warn, #f59e0b)" }}
                  />
                )}
                <span className="truncate min-w-0">{name}</span>
                <button
                  className="shrink-0 ml-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                  title={t("common.action.close")}
                  style={{ color: "var(--t-text-dim)" }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => { e.stopPropagation(); requestClose(tab.id); }}
                >
                  <Icon icon="lucide:x" width={13} />
                </button>
              </div>
            </Fragment>
          );
        })}
        {reorderIndex === tabs.length && (
          <div className="shrink-0 self-stretch" style={{ width: 2, background: "var(--t-accent)" }} />
        )}
      </div>

      {pendingClose && (
        <ConfirmModal
          title={t("fileTransfer.editor.tabStrip.discardTitle")}
          message={t("fileTransfer.editor.tabStrip.discardMessage", { name: pendingName })}
          confirmLabel={t("fileTransfer.editor.tabStrip.discard")}
          onConfirm={() => { closeTab(pendingClose); setPendingClose(null); }}
          onCancel={() => setPendingClose(null)}
        />
      )}
    </div>
  );
}
