import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import type { Connection, TerminalSession } from "@/types";
import type { NavItem } from "@/stores/uiStore";
import { TitlebarTab, sessionTabIcon, buildSessionTabHandlers } from "@/components/layout/TitlebarTab";
import { HostStackMenu } from "@/components/layout/HostStackMenu";
import { useHoverIntent } from "@/hooks/useHoverIntent";
import { useDragStore } from "@/stores/dragStore";
import { closeSessionTabs } from "@/services/closeSession";
import { canDuplicateSession, duplicateSession } from "@/services/duplicateSession";
import { pinListExtra } from "@/utils/sessionMenuItems";
import { stackMemberLabels, shownMember, worstStatus } from "@/utils/titlebarItems";
import { sessionStatusTone, STATUS_TONE_COLOR } from "@/utils/statusTone";

interface StackTabProps {
  itemKey: string;
  connectionId: string;
  members: TerminalSession[];
  connections: Connection[];
  activeSessionId: string | null;
  activeNav: NavItem;
  sftpPanelOpen: boolean;
  splitTabActive: boolean;
  hostPanelPinned: boolean;
  setHostPanelPinned: (pinned: boolean) => void;
  lastActiveByHost: Record<string, string>;
  mcpBar: ReactNode;
  title: string | undefined;
  buildHandlers: ReturnType<typeof buildSessionTabHandlers>;
}

export function StackTab({
  itemKey, connectionId, members, connections, activeSessionId, activeNav, sftpPanelOpen, splitTabActive,
  hostPanelPinned, setHostPanelPinned, lastActiveByHost, mcpBar, title, buildHandlers,
}: StackTabProps) {
  const { t } = useTranslation();
  const [hold, setHold] = useState(false);
  const hover = useHoverIntent({ openDelay: 250, closeDelay: 300, hold });
  const isDraggingTitlebarItem = useDragStore((s) => s.isDragging && s.dragType === "tab");
  const isDraggingPane = useDragStore((s) => s.isDragging && s.dragType === "pane");
  const dragBlocksHover = isDraggingTitlebarItem || isDraggingPane;

  useEffect(() => {
    if (dragBlocksHover) hover.setOpen(false);
  }, [dragBlocksHover, hover.setOpen]);

  const shown = shownMember(members, activeSessionId, lastActiveByHost[connectionId]);
  const active = members.some((m) => m.id === activeSessionId) && activeNav === "terminal" && !sftpPanelOpen && !splitTabActive;
  const connection = connections.find((c) => c.id === connectionId);
  const pinnedForHost = hostPanelPinned && active;
  const extras: ContextMenuItem[] = [
    ...(canDuplicateSession(shown)
      ? [{ label: t("layout.titleBar.stack.newSessionOn", { host: shown.connectionName }), icon: "lucide:plus", onClick: () => duplicateSession(shown.id, "tab") }]
      : []),
    pinListExtra(t, pinnedForHost, () => setHostPanelPinned(!hostPanelPinned)),
    { label: t("layout.titleBar.stack.closeAll", { count: members.length }), icon: "lucide:x", danger: true, onClick: () => closeSessionTabs(members.map((m) => m.id)) },
  ];
  const handlers = buildHandlers(shown, itemKey, active, extras);

  const worst = worstStatus(members);
  const tone = sessionStatusTone(worst);
  const baseIcon = sessionTabIcon(shown, connection, active, tone);
  const icon = worst === "connected" ? baseIcon : (
    <span className="relative inline-flex">
      {baseIcon}
      <span
        className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full"
        style={{ background: STATUS_TONE_COLOR[tone], boxShadow: "0 0 0 2px var(--t-bg-terminal)" }}
      />
    </span>
  );

  const labels = stackMemberLabels(members);
  const info = labels.get(shown.id);
  const suffix = !info ? "" : info.number === 0 ? ` · ${info.label}` : info.number > 1 ? ` (${info.number})` : "";
  const label = (
    <>
      {shown.connectionName}
      <span className="text-(--t-text-muted) font-medium">{suffix}</span>
    </>
  );

  const trailing = (
    <>
      <span
        className={`inline-flex items-center justify-center min-w-[1.35rem] h-[1.35rem] px-1.5 rounded-full text-[11px] font-bold tabular-nums ${
          active ? "bg-(--t-accent) text-(--t-bg-base)" : "bg-(--t-bg-elevated) text-(--t-text-secondary)"
        }`}
      >
        {members.length}
      </span>
      {!pinnedForHost && (
        <span
          data-testid={`stack-chevron-${connectionId}`}
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); hover.setOpen(!hover.open); }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            e.stopPropagation();
            hover.setOpen(!hover.open);
          }}
          className="flex items-center justify-center rounded-sm p-0.5"
          style={{ color: active ? "var(--t-tab-active-text)" : "var(--t-text-muted)" }}
        >
          <Icon
            icon="lucide:chevron-down"
            width={14}
            style={{ transform: hover.open ? "rotate(180deg)" : undefined, transition: "transform 150ms ease" }}
          />
        </span>
      )}
    </>
  );

  return (
    <>
      <TitlebarTab
        buttonRef={hover.anchorRef}
        itemKey={itemKey}
        active={active}
        icon={icon}
        label={label}
        title={title}
        mcpBar={mcpBar}
        trailing={trailing}
        {...handlers}
        onMouseEnter={pinnedForHost || dragBlocksHover ? undefined : hover.bind.onMouseEnter}
        onMouseLeave={pinnedForHost || dragBlocksHover ? undefined : hover.bind.onMouseLeave}
      />
      <HostStackMenu
        members={members}
        labels={labels}
        shownId={shown.id}
        activeSessionId={activeSessionId}
        anchorRef={hover.anchorRef}
        surfaceRef={hover.surfaceRef}
        open={hover.open}
        onClose={() => hover.setOpen(false)}
        hoverBind={hover.bind}
        onHoldChange={setHold}
      />
    </>
  );
}
