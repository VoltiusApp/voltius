import type { ReactNode } from "react";
import { Icon } from "@iconify/react";
import type { Connection, TerminalSession } from "@/types";
import { getConnectionIcon, getConnectionIconColor } from "@/utils/icons";
import { InlineNameEditor } from "@/components/shared/InlineNameEditor";
import { StatusDot } from "@/components/shared/StatusDot";
import { STATUS_TONE_COLOR, type StatusTone } from "@/utils/statusTone";

export function sessionTabIcon(
  session: TerminalSession,
  connection: Connection | undefined,
  active: boolean,
  tone: StatusTone,
): ReactNode {
  const isLocal = session.type === "local";
  const connectionIcon = !isLocal && connection ? (connection.icon || connection.distro) : null;
  const distroIcon = connectionIcon ? getConnectionIcon(connectionIcon) : null;
  const distroBg = connectionIcon ? getConnectionIconColor(connectionIcon) : null;

  if (distroIcon) {
    return (
      <span
        className="flex items-center justify-center size-6 rounded-md shrink-0"
        style={{ background: distroBg ?? "transparent", color: "#fff" }}
      >
        <Icon icon={distroIcon} width={16} />
      </span>
    );
  }
  if (isLocal) {
    return (
      <span
        className="flex items-center justify-center size-6 rounded-md shrink-0"
        style={{ color: active ? "var(--t-tab-active-text)" : STATUS_TONE_COLOR[tone] }}
      >
        <Icon icon="lucide:terminal" width={14} />
      </span>
    );
  }
  return <StatusDot tone={tone} />;
}

export function tabSurfaceStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "var(--t-tab-active-bg)" : "var(--t-tab-bg)",
    color: active ? "var(--t-tab-active-text)" : "var(--t-text-secondary)",
    border: active ? "1px solid var(--t-tab-active-border)" : "1px solid transparent",
  };
}

export function TitlebarTab({
  itemKey,
  active,
  icon,
  label,
  title,
  mcpBar,
  trailing,
  renaming,
  renameValue,
  renameAriaLabel,
  onRenameCommit,
  onRenameCancel,
  onClick,
  onLabelClick,
  onClose,
  onContextMenu,
  onDoubleClick,
  onPointerDown,
  onMouseEnter,
  onMouseLeave,
  buttonRef,
}: {
  itemKey: string;
  active: boolean;
  icon: ReactNode;
  label: ReactNode;
  title?: string;
  mcpBar?: ReactNode;
  trailing?: ReactNode;
  renaming: boolean;
  renameValue: string;
  renameAriaLabel: string;
  onRenameCommit: (name: string) => void;
  onRenameCancel: () => void;
  onClick: () => void;
  onLabelClick: (e: React.MouseEvent) => void;
  onClose: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  if (renaming) {
    return (
      <div
        data-titlebar-key={itemKey}
        className="relative flex items-center gap-2 h-9 px-2 rounded-xl text-base font-medium-bold shrink-0 overflow-hidden"
        style={tabSurfaceStyle(active)}
      >
        {icon}
        <InlineNameEditor
          value={renameValue}
          ariaLabel={renameAriaLabel}
          onCommit={onRenameCommit}
          onCancel={onRenameCancel}
        />
      </div>
    );
  }

  return (
    <button
      ref={buttonRef}
      data-titlebar-key={itemKey}
      data-strip-active={active}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onDoubleClick={onDoubleClick}
      onPointerDown={onPointerDown}
      className="group relative flex items-center gap-2 h-9 px-2 rounded-xl text-base font-medium-bold shrink-0 transition-all overflow-hidden"
      title={title}
      style={tabSurfaceStyle(active)}
      onMouseEnter={(e) => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--t-bg-toolbar)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-primary)";
        }
        onMouseEnter?.(e);
      }}
      onMouseLeave={(e) => {
        if (!active) {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--t-tab-bg)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--t-text-secondary)";
        }
        onMouseLeave?.(e);
      }}
    >
      {mcpBar}
      {icon}
      <span className="max-w-[140px] truncate" onClick={onLabelClick}>
        {label}
      </span>
      {trailing}
      <span
        onClick={onClose}
        className="ml-0.5 opacity-0 group-hover:opacity-100 transition-opacity rounded-sm p-0.5"
        style={{ color: active ? "var(--t-tab-active-text)" : "var(--t-text-muted)" }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = "1"; (e.currentTarget as HTMLElement).style.color = "var(--t-status-error)"; }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.color = active ? "var(--t-tab-active-text)" : "var(--t-text-muted)"; }}
      >
        <span className="[&_path]:stroke-[2.1]">
          <Icon icon="lucide:x" width={20} />
        </span>
      </span>
    </button>
  );
}
