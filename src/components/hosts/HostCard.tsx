import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import type { Connection, VaultOption } from "@/types";
import { BaseCard } from "@/components/shared/BaseCard";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { CardActionButton } from "@/components/shared/CardActionButton";
import { OverflowTagList } from "@/components/shared/OverflowTagList";
import { type ContextMenuItem } from "@/components/shared/ContextMenu";
import { StatusDot } from "@/components/shared/StatusDot";
import { MiniAvatar } from "@/components/shared/AvatarStack";
import { useConnectionPresence } from "@/hooks/useConnectionPresence";
import { useUIContributions } from "@/hooks/useUIContributions";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { buildConnectionMenuItems } from "@/utils/connectionMenuItems";
import { useConnectionStore, connectionToFormData } from "@/stores/connectionStore";
import { useHostPingStore } from "@/stores/hostPingStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import { useUIStore } from "@/stores/uiStore";
import { useTeamStore } from "@/stores/teamStore";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { writeClipboard } from "@/utils/clipboard";
import { useNotificationStore } from "@/stores/notificationStore";
import type { TeamMember } from "@/stores/teamStore";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";

const EMPTY_TEAM_MEMBERS: TeamMember[] = [];

interface Props {
  connection: Connection;
  isActive?: boolean;
  isSelected?: boolean;
  isEditing?: boolean;
  isFocused?: boolean;
  canEdit?: boolean;
  /** Other vaults this item can be moved/copied to (omit current vault) */
  vaults?: VaultOption[];
  layout?: "grid" | "list";
  onSelect?: (id: string, event: React.MouseEvent<HTMLDivElement>) => void;
  onConnect: (conn: Connection) => void;
  onEdit: (conn: Connection) => void;
  onDuplicate: (conn: Connection) => void;
  onExecuteSnippet?: (conn: Connection) => void;
  onDelete: (id: string) => void;
  onMoveToVault?: (conn: Connection, vaultId: string) => void;
  onCopyToVault?: (conn: Connection, vaultId: string) => void;
  bulkContextMenuItems?: ContextMenuItem[];
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export default function HostCard({
  connection, isActive, isSelected, isEditing, isFocused, canEdit = true,
  vaults = [], layout = "grid",
  onSelect, onConnect, onEdit, onDuplicate, onExecuteSnippet, onDelete,
  onMoveToVault, onCopyToVault,
  bulkContextMenuItems, onPointerDown,
}: Props) {
  const { t } = useTranslation();
  const isList = layout === "list";
  const isSerial = connection.connection_type === "serial";
  const isFtp = connection.connection_type === "ftp";
  const protocolLabel = isSerial ? "SERIAL" : isFtp ? (connection.ftp_secure ? "FTPS" : "FTP") : "SSH";
  const contributions = useUIContributions("connection.contextMenu", connection);
  const isSynced = useSyncPrefsStore((s) => s.isObjectSynced(connection.id, "connection"));
  const pinConnection = useConnectionStore((s) => s.pinConnection);
  const pinConnectionForTeam = useConnectionStore((s) => s.pinConnectionForTeam);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const effectivePinned = useEffectivePinned(connection, "connection");
  const pinSource = useEffectivePinSource(connection, "connection");
  const isTeamVault = useTeamStore((s) => s.teams.some((t) => t.id === connection.vault_id));
  const teamMembers = useTeamStore((s) => connection.vault_id ? s.membersByTeam[connection.vault_id] ?? EMPTY_TEAM_MEMBERS : EMPTY_TEAM_MEMBERS);
  const pinnerName = (() => {
    if (!isTeamVault || pinSource === "none" || pinSource === "personal") return undefined;
    const updatedBy = (connection as { updated_by?: string }).updated_by;
    const member = updatedBy ? teamMembers.find((m) => m.user_id === updatedBy) : undefined;
    return member?.display_name ?? t("hosts.card.teamMemberFallback");
  })();
  const handlePinClick = () => {
    if (!isTeamVault) {
      pinConnection(connection.id, !effectivePinned).catch(() => {});
      return;
    }
    const next = nextPersonalPinValue(pinSource);
    pinConnection(connection.id, next).catch(() => {});
  };
  const pinTooltip = (() => {
    if (!isTeamVault) return effectivePinned ? t("hosts.card.unpin") : t("hosts.card.pin");
    switch (pinSource) {
      case "none":
        return t("hosts.card.pin");
      case "personal":
        return t("hosts.card.pinned");
      case "team":
        return t("hosts.card.pinnedByTeam", { name: pinnerName });
      case "team+personal":
        return t("hosts.card.pinnedByTeamAndPersonal", { name: pinnerName });
      case "team-hidden":
        return t("hosts.card.hiddenPinnedByTeam", { name: pinnerName });
    }
  })();
  const pinIcon = pinSource === "team-hidden" ? "lucide:pin-off" : "lucide:pin";
  const pinColor =
    pinSource === "personal" || pinSource === "team+personal"
      ? "var(--t-accent)"
      : pinSource === "team"
      ? "var(--t-text-secondary)"
      : "var(--t-text-dim)";
  const pinAlwaysVisible = pinSource !== "none" && pinSource !== "team-hidden";
  const [pingEnabled] = useToggle("reachability");
  const pingStatus = useHostPingStore((s) => s.statuses[connection.id]);
  const pingLatency = useHostPingStore((s) => s.latencies[connection.id]);
  const showPingDot = !isSerial && pingEnabled && !connection.ping_disabled;
  const presence = useConnectionPresence(connection);
  const presenceTitle = presence
    ? presence.overflow > 0
      ? t("hosts.card.inUseByOverflow", { name: presence.primary.displayName, count: presence.overflow })
      : t("hosts.card.inUseBy", { name: presence.primary.displayName })
    : "";
  const presenceAvatar = presence && (
    <span className="flex items-center" title={presenceTitle}>
      <MiniAvatar name={presence.primary.displayName} size={18} />
      {presence.overflow > 0 && (
        <span className="ml-1 text-[10px] font-semibold px-1 rounded-full bg-(--t-bg-elevated) text-(--t-text-dim)">
          +{presence.overflow}
        </span>
      )}
    </span>
  );

  const contextMenuItems: ContextMenuItem[] = [
    ...(canEdit ? [{ label: t("common.action.edit"), icon: "lucide:square-pen", onClick: () => onEdit(connection), shortcut: "E" }] : []),
    ...(!isSerial ? [{ label: t("hosts.card.openInSftp"), icon: "lucide:folder-open", onClick: () => useUIStore.getState().openSftpWith(connection.id) }] : []),
    ...(connection.host ? [{
      label: t("hosts.card.copyHostnameIp"),
      icon: "lucide:clipboard-copy",
      onClick: () => {
        void writeClipboard(connection.host);
        useNotificationStore.getState().addToast({
          pluginId: "core",
          pluginName: "Voltius",
          type: "toast",
          message: t("hosts.card.copiedHost", { host: connection.host }),
          severity: "success",
          duration: 2000,
        });
      },
    }] : []),
    ...(!isSerial && !isFtp && onExecuteSnippet ? [{ label: t("hosts.card.executeSnippet"), icon: "lucide:braces", onClick: () => onExecuteSnippet(connection), divider: true }] : []),
    ...buildConnectionMenuItems({
      canEdit,
      contributions,
      vaults,
      isSynced,
      pingDisabled: connection.ping_disabled ?? false,
      connectShortcut: "↩",
      duplicateShortcut: "D",
      onConnect: () => onConnect(connection),
      onDuplicate: () => onDuplicate(connection),
      onMoveToVault: onMoveToVault ? (vId) => onMoveToVault(connection, vId) : undefined,
      onCopyToVault: onCopyToVault ? (vId) => onCopyToVault(connection, vId) : undefined,
      onToggleSync: () => useSyncPrefsStore.getState().toggleExcluded(connection.id),
      onTogglePing: () => updateConnection(connection.id, { ...connectionToFormData(connection), ping_disabled: !connection.ping_disabled }),
      onDelete: canEdit ? () => onDelete(connection.id) : undefined,
      extras: [
        {
          label: isTeamVault
            ? (pinSource === "personal" || pinSource === "team+personal")
              ? t("hosts.card.unpinForMe")
              : pinSource === "team-hidden"
              ? t("hosts.card.showInMyView")
              : pinSource === "team"
              ? t("hosts.card.hideForMe")
              : t("hosts.card.pinForMe")
            : effectivePinned ? t("hosts.card.unpin") : t("hosts.card.pin"),
          icon: (pinSource === "personal" || pinSource === "team+personal" || (!isTeamVault && effectivePinned))
            ? "lucide:pin-off"
            : "lucide:pin",
          onClick: handlePinClick,
          divider: true,
        },
        ...(canEdit && isTeamVault ? [{
          label: (connection.pinned === true) ? t("hosts.card.unpinForTeam") : t("hosts.card.pinForTeam"),
          icon: "lucide:users",
          onClick: () => pinConnectionForTeam(connection.id, !(connection.pinned === true)).catch(() => {}),
        }] : []),
      ],
    }),
  ];

  const contentColRef = useRef<HTMLDivElement>(null);
  const terminalBtnRef = useRef<HTMLButtonElement>(null);
  const [tagMaxWidth, setTagMaxWidth] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    if (isList) return;
    const btn = terminalBtnRef.current;
    const col = contentColRef.current;
    if (!btn || !col) return;

    const measure = () => {
      const colRect = col.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      const width = btnRect.left - colRect.left;
      if (width > 0) setTagMaxWidth(width);
    };

    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(btn);
    obs.observe(col);
    return () => obs.disconnect();
  }, [isList]);

  const pingColor = pingStatus === "up"
    ? "var(--t-status-connected)"
    : pingStatus === "down"
    ? "var(--t-status-error)"
    : "var(--t-text-dim)";

  const syncIcon = !isSynced && (
    <span title={t("hosts.card.cloudSyncDisabled")} className="text-(--t-text-dim) flex items-center">
      <Icon icon="lucide:cloud-off" width={18} />
    </span>
  );

  return (
    <BaseCard
      data-host-card="true"
      data-connection-id={connection.id}
      data-selectable-id={connection.id}
      isList={isList}
      glass={!isList}
      isSelected={isSelected}
      isEditing={isEditing}
      isActive={isActive}
      isFocused={isFocused}
      onPointerDown={onPointerDown}
      onMouseEnter={showPingDot ? () => useHostPingStore.getState().addPriorityConnection(connection.id) : undefined}
      onMouseLeave={showPingDot ? () => useHostPingStore.getState().removePriorityConnection(connection.id) : undefined}
      onClick={(e) => onSelect?.(connection.id, e)}
      onDoubleClick={() => onConnect(connection)}
      bulkContextMenuItems={bulkContextMenuItems}
      contextMenuItems={contextMenuItems}
    >
      {isList ? (
        <>
          <div className="relative shrink-0">
            <ConnectionAvatar connection={connection} size={28} />
            {showPingDot && (
              <StatusDot color={pingColor} animate={pingStatus === "up"} fast={isActive} />
            )}
          </div>
          <p className="text-sm font-medium-bold truncate w-52 shrink-0 text-(--t-text-bright)">
            {connectionDisplayName(connection)}
          </p>
          <p className="text-xs truncate flex-1 text-(--t-text-secondary)">
            {isSerial
              ? `serial · ${connection.serial_baud ?? 115200} baud`
              : `${connection.username}@${connection.host}:${connection.port}${showPingDot && pingStatus === "up" && pingLatency !== undefined ? ` · ${pingLatency}ms` : ""}`
            }
          </p>
          {connection.tags.length > 0 && (
            <OverflowTagList tags={connection.tags} className="max-w-32 flex-1" />
          )}
          <div className="flex items-center gap-1 shrink-0">
            {presenceAvatar}
            {syncIcon}
            {canEdit && <CardActionButton icon="lucide:square-pen" title={t("common.action.edit")} onClick={() => onEdit(connection)} />}
            {canEdit && <CardActionButton icon="lucide:trash-2" title={t("common.action.delete")} onClick={() => onDelete(connection.id)} danger />}
            {!isSerial && !isFtp && <CardActionButton icon="lucide:folder-open" title={t("hosts.card.openInSftp")} onClick={() => useUIStore.getState().openSftpWith(connection.id)} />}
            <button
              onClick={(e) => { e.stopPropagation(); onConnect(connection); }}
              className="flex items-center justify-center p-1.5 rounded-lg transition-colors text-(--t-accent)"
              onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--t-accent) 16%, transparent)")}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              title={isFtp ? t("hosts.card.openFilesTitle") : t("hosts.card.connectTitle")}
            >
              <Icon icon={isFtp ? "lucide:folder-open" : "lucide:terminal"} width={18} />
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="flex-1 min-w-0 self-start flex flex-col gap-1">
            <div className="flex items-start gap-2 min-w-0">
              <ConnectionAvatar connection={connection} size={30} />
              <div ref={contentColRef} className="flex flex-col gap-0.5 flex-1 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <p className="text-sm font-bold truncate text-(--t-text-bright)">
                    {connectionDisplayName(connection)}
                  </p>
                  <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-(--t-bg-input) text-(--t-text-dim) border border-(--t-border)">
                    {protocolLabel}
                  </span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handlePinClick(); }}
                    className={`shrink-0 flex items-center transition-colors ${pinAlwaysVisible ? "opacity-100" : "opacity-0 group-hover:opacity-100 hover:text-(--t-text-bright)"}`}
                    style={{ color: pinColor }}
                    title={pinTooltip}
                  >
                    <Icon icon={pinIcon} width={14} />
                  </button>
                  {(showPingDot || syncIcon || presenceAvatar) && (
                    <div className="flex items-center gap-1.5 ml-auto shrink-0 mr-1">
                      {presenceAvatar}
                      {showPingDot && (
                        <>
                          {pingStatus === "up" && pingLatency !== undefined && (
                            <span className="text-xs font-medium" style={{ color: pingColor }}>
                              {pingLatency} ms
                            </span>
                          )}
                          <span className="relative w-6 h-6 -my-1.5 shrink-0">
                            <StatusDot
                              color={pingColor}
                              animate={pingStatus === "up"}
                              fast={isActive}
                              size={12}
                              className="bottom-auto right-auto top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2"
                            />
                          </span>
                        </>
                      )}
                      {syncIcon}
                    </div>
                  )}
                </div>
                <div className="self-start w-full min-h-[26px]" style={{ maxWidth: tagMaxWidth }}>
                  {connection.tags.length > 0 && (
                    <OverflowTagList tags={connection.tags} className="w-full" badgeClassName="py-0 text-[11px]" maxWidth={tagMaxWidth} />
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-end">
              <div className="flex items-center gap-1 flex-1 -mb-1.5">
                {canEdit && (
                  <CardActionButton icon="lucide:trash-2" title={t("common.action.delete")} danger reveal={false} onClick={() => onDelete(connection.id)} />
                )}
                {canEdit && (
                  <CardActionButton icon="lucide:square-pen" title={t("common.action.edit")} reveal={false} onClick={() => onEdit(connection)} />
                )}
                {!isSerial && !isFtp && (
                  <CardActionButton icon="lucide:folder-open" title={t("hosts.card.openInSftp")} reveal={false} onClick={() => useUIStore.getState().openSftpWith(connection.id)} />
                )}
              </div>

              {/* Terminal connect button — bleeds into card's bottom-right corner */}
              <button
                ref={terminalBtnRef}
                onClick={(e) => { e.stopPropagation(); onConnect(connection); }}
                className="terminal-connect-btn -mt-5 -mr-[calc(0.75rem+2px)] -mb-[calc(0.75rem+2px)] pr-[calc(0.75rem+2px)] pb-3.5 pt-2.5 pl-3 rounded-tl-xl rounded-br-2xl bg-(--t-bg-terminal) text-(--t-terminal-foreground) hover:brightness-150 transition-all text-xs flex flex-col min-w-0 overflow-hidden max-w-[75%]"
                style={{ fontFamily: "var(--t-terminal-font-family)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.07), inset 1px 0 0 rgba(255,255,255,0.07)" }}
                title={isFtp ? t("hosts.card.openFilesTitle") : t("hosts.card.connectTitle")}
              >
                <div className="flex gap-1 mb-1.5 shrink-0">
                  <span className="w-2 h-2 rounded-full bg-[#ff5f56]" />
                  <span className="w-2 h-2 rounded-full bg-[#ffbd2e]" />
                  <span className="w-2 h-2 rounded-full bg-[#27c93f]" />
                </div>
                <div className="flex items-center min-w-0 w-full">
                  {isFtp ? (
                    <>
                      <span className="truncate" style={{ color: "var(--t-terminal-cyan)" }}>{connection.host}</span>
                      <span className="shrink-0"> · files</span>
                    </>
                  ) : isSerial ? (
                    <>
                      <span className="truncate" style={{ color: "var(--t-terminal-yellow)" }}>{connection.serial_port ?? "serial"}</span>
                      <span className="shrink-0"> &gt;<span className="cursor-blink-char">_</span></span>
                    </>
                  ) : (
                    <>
                      <span className="truncate">
                        <span style={{ color: "var(--t-terminal-green)" }}>{connection.username}</span>
                        <span>@</span>
                        <span style={{ color: "var(--t-terminal-cyan)" }}>{connection.host}</span>
                      </span>
                      <span className="shrink-0"> &gt;<span className="cursor-blink-char">_</span></span>
                    </>
                  )}
                </div>
              </button>
            </div>
          </div>
        </>
      )}
    </BaseCard>
  );
}
