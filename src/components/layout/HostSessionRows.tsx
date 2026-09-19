import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import type { TFunction } from "i18next";
import type { TerminalSession } from "@/types";
import { StatusDot } from "@/components/shared/StatusDot";
import { InlineNameEditor } from "@/components/shared/InlineNameEditor";
import { ContextMenu, useContextMenu } from "@/components/shared/ContextMenu";
import { sessionMenuItems } from "@/utils/sessionMenuItems";
import { stackMemberLabels } from "@/utils/titlebarItems";
import { sessionStatusTone } from "@/utils/statusTone";
import { sessionStatusLine } from "@/utils/sessionStatusLine";
import { useConnectedSince } from "@/services/sessionUptime";
import { activateSessionTab, activateSplitTabPane } from "@/services/tabActivation";
import { closeSessionTabs } from "@/services/closeSession";
import { findSessionPane } from "@/services/duplicateSession";
import { openInSplit } from "@/services/hostStack";
import { useLayoutStore } from "@/stores/layoutStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useDragStore, shouldSuppressDragClick } from "@/stores/dragStore";
import { titlebarConnectionOf } from "@/utils/titlebarItems";

export type HostSessionRow = { session: TerminalSession; splitTabId: string | null };

interface HostSessionRowsProps {
  rows: HostSessionRow[];
  members: TerminalSession[];
  shownId: string;
  activeSessionId: string | null;
  variant: "compact" | "panel";
  onActivate: () => void;
}

export function HostSessionRows({ rows, members, shownId, activeSessionId, variant, onActivate }: HostSessionRowsProps) {
  const { t } = useTranslation();
  const labels = stackMemberLabels(members);
  const [now, setNow] = useState(Date.now());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const { pos, open: openMenu, close: closeMenu } = useContextMenu();
  const [menuSessionId, setMenuSessionId] = useState<string | null>(null);
  const menuSession = menuSessionId ? rows.find((row) => row.session.id === menuSessionId)?.session ?? null : null;

  useEffect(() => {
    if (variant !== "panel") return;
    const interval = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, [variant]);

  return (
    <>
      {rows.map((row) => (
        <HostSessionRowItem
          key={row.session.id}
          row={row}
          label={labels.get(row.session.id)}
          active={row.session.id === activeSessionId}
          variant={variant}
          members={members}
          shownId={shownId}
          now={now}
          t={t}
          renaming={renamingId === row.session.id}
          onStartRename={() => setRenamingId(row.session.id)}
          onEndRename={() => setRenamingId(null)}
          onActivate={onActivate}
          onContextMenu={(e) => { setMenuSessionId(row.session.id); openMenu(e); }}
        />
      ))}
      {pos && menuSession && (
        <ContextMenu
          items={sessionMenuItems({
            session: menuSession,
            t,
            closeLabel: t("layout.titleBar.closeTab"),
            onClose: () => closeSessionTabs([menuSession.id]),
            onRename: () => setRenamingId(menuSession.id),
          })}
          pos={pos}
          onClose={closeMenu}
        />
      )}
    </>
  );
}

function HostSessionRowItem({
  row, label, active, variant, members, shownId, now, t, renaming, onStartRename, onEndRename, onActivate, onContextMenu,
}: {
  row: HostSessionRow;
  label: { label: string; number: number } | undefined;
  active: boolean;
  variant: "compact" | "panel";
  members: TerminalSession[];
  shownId: string;
  now: number;
  t: TFunction;
  renaming: boolean;
  onStartRename: () => void;
  onEndRename: () => void;
  onActivate: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const { session, splitTabId } = row;
  const since = useConnectedSince(variant === "panel" ? session.id : null);
  const dropCue = useDragStore((s) => {
    if (variant !== "panel" || !s.isDragging || s.dragType !== "tab" || s.fromStackList) return null;
    if (!s.dropTarget || s.dropTarget.type !== "titlebar" || s.dropTarget.targetKey !== `session:${session.id}`) return null;
    return s.dropTarget.placement ?? "after";
  });

  const label_ = label?.label ?? session.connectionName;
  const statusTone = sessionStatusTone(session.status);

  const activate = () => {
    if (shouldSuppressDragClick()) return;
    if (splitTabId) {
      const paneId = findSessionPane(useLayoutStore.getState().splitTabs, session.id)?.paneId;
      activateSplitTabPane(splitTabId, paneId);
    } else {
      activateSessionTab(session.id);
    }
    onActivate();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 0) {
      useDragStore.getState().beginTabDrag(session.id, e.clientX, e.clientY, `session:${session.id}`, { fromStackList: variant === "compact" });
    }
    if (e.button === 1) {
      e.preventDefault();
      closeSessionTabs([session.id]);
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (variant !== "panel") return;
    const drag = useDragStore.getState();
    if (!drag.isDragging || drag.dragType !== "tab" || drag.fromStackList || !drag.sessionId) return;
    if (titlebarConnectionOf(drag.sessionId) !== session.connectionId) return;
    const rect = e.currentTarget.getBoundingClientRect();
    useDragStore.getState().setDropTarget({
      type: "titlebar",
      targetKey: `session:${session.id}`,
      placement: e.clientY < rect.top + rect.height / 2 ? "before" : "after",
    });
  };

  if (renaming) {
    return (
      <div
        data-titlebar-key={`session:${session.id}`}
        className={variant === "compact" ? "flex items-center gap-2 px-3 py-2 text-xs" : "flex items-center gap-2 px-4 py-3 border-b border-b-(--t-border)"}
      >
        <StatusDot tone={statusTone} size="sm" />
        <InlineNameEditor
          value={label_}
          ariaLabel={t("layout.titleBar.renameTab")}
          onCommit={(name) => { useSessionStore.getState().renameSession(session.id, name); onEndRename(); }}
          onCancel={onEndRename}
        />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      data-titlebar-key={`session:${session.id}`}
      onClick={activate}
      onKeyDown={(e) => { if (e.key === "Enter") activate(); }}
      onPointerDown={onPointerDown}
      onMouseMove={onMouseMove}
      onDoubleClick={variant === "panel" ? onStartRename : undefined}
      onContextMenu={onContextMenu}
      className={`group relative flex items-center gap-2 cursor-pointer rounded-lg transition-colors ${
        variant === "compact" ? "px-3 py-2 text-xs" : "px-4 py-3 border-b border-b-(--t-border)"
      }`}
      style={variant === "panel" && active ? { background: "var(--t-bg-elevated)" } : undefined}
    >
      {dropCue === "before" && <div className="absolute left-2 right-2 top-0 h-0.5 rounded-full bg-(--t-accent)" />}
      <StatusDot tone={statusTone} size="sm" />
      <div className="flex-1 min-w-0">
        <p className={`truncate ${active ? "text-(--t-accent)" : ""}`}>{label_}</p>
        {variant === "panel" && (
          <p className="flex items-center gap-1 text-xs text-(--t-text-muted)">
            {splitTabId && (
              <span className="flex items-center gap-1">
                <Icon icon="lucide:layout-dashboard" width={12} />
                {t("layout.titleBar.stack.inSplit")} ·
              </span>
            )}
            {sessionStatusLine(session, since, now, t)}
          </p>
        )}
      </div>
      <span
        className={variant === "compact"
          ? "hidden group-hover:inline-flex items-center gap-1"
          : "opacity-0 group-hover:opacity-100 inline-flex items-center gap-1 transition-opacity"}
      >
        {!splitTabId && (
          <button
            type="button"
            title={t("layout.titleBar.stack.openInSplit")}
            onClick={(e) => { e.stopPropagation(); openInSplit(session.id, members, shownId); }}
            className="p-1 rounded-sm text-(--t-text-muted) hover:text-(--t-text-primary)"
          >
            <Icon icon="lucide:columns-2" width={14} />
          </button>
        )}
        <button
          type="button"
          title={t("layout.titleBar.closeTab")}
          onClick={(e) => { e.stopPropagation(); closeSessionTabs([session.id]); }}
          className="p-1 rounded-sm text-(--t-text-muted) hover:text-(--t-status-error)"
        >
          <Icon icon="lucide:x" width={14} />
        </button>
      </span>
      {dropCue === "after" && <div className="absolute left-2 right-2 bottom-0 h-0.5 rounded-full bg-(--t-accent)" />}
    </div>
  );
}
