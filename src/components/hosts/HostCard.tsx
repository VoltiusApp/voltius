import { Icon } from "@iconify/react";
import type { Connection, VaultOption } from "@/types";
import { BaseCard } from "@/components/shared/BaseCard";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { CardActionButton } from "@/components/shared/CardActionButton";
import { type ContextMenuItem } from "@/components/shared/ContextMenu";
import { useUIContributions } from "@/hooks/useUIContributions";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { buildConnectionMenuItems } from "@/utils/connectionMenuItems";
import { useConnectionStore } from "@/stores/connectionStore";
import { useHostPingStore } from "@/stores/hostPingStore";

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
  onDelete: (id: string) => void;
  onMoveToVault?: (conn: Connection, vaultId: string) => void;
  onCopyToVault?: (conn: Connection, vaultId: string) => void;
  bulkContextMenuItems?: ContextMenuItem[];
  onDragStart?: (e: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
}

function displayName(c: { name?: string; username: string; host: string; port: number }) {
  return c.name?.trim() || `${c.username}@${c.host}:${c.port}`;
}

export default function HostCard({
  connection, isActive, isSelected, isEditing, isFocused, canEdit = true,
  vaults = [], layout = "grid",
  onSelect, onConnect, onEdit, onDuplicate, onDelete,
  onMoveToVault, onCopyToVault,
  bulkContextMenuItems, onDragStart, onDragEnd,
}: Props) {
  const isList = layout === "list";
  const contributions = useUIContributions("connection.contextMenu", connection);
  const isSynced = useSyncPrefsStore((s) => s.isObjectSynced(connection.id, "connection"));
  const pinConnection = useConnectionStore((s) => s.pinConnection);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const pingEnabled = useHostPingStore((s) => s.enabled);
  const pingStatus = useHostPingStore((s) => s.statuses[connection.id]);
  const showPingDot = pingEnabled && !connection.ping_disabled;

  const contextMenuItems: ContextMenuItem[] = [
    ...(canEdit ? [{ label: "Edit", icon: "lucide:pencil", onClick: () => onEdit(connection), shortcut: "E" }] : []),
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
      onTogglePing: () => updateConnection(connection.id, { name: connection.name, host: connection.host, port: connection.port, username: connection.username, auth_type: connection.auth_type, tags: connection.tags, identity_id: connection.identity_id, folder_id: connection.folder_id, vault_id: connection.vault_id, jump_hosts: connection.jump_hosts, env_vars: connection.env_vars, agent_forwarding: connection.agent_forwarding, pre_command: connection.pre_command, post_command: connection.post_command, terminal_encoding: connection.terminal_encoding, pinned: connection.pinned, ping_disabled: !connection.ping_disabled }),
      onDelete: canEdit ? () => onDelete(connection.id) : undefined,
      extras: [{
        label: connection.pinned ? "Unpin" : "Pin",
        icon: connection.pinned ? "lucide:pin-off" : "lucide:pin",
        onClick: () => pinConnection(connection.id, !connection.pinned).catch(() => {}),
        divider: true,
      }],
    }),
  ];

  return (
    <BaseCard
      data-host-card="true"
      data-connection-id={connection.id}
      data-selectable-id={connection.id}
      isList={isList}
      isSelected={isSelected}
      isEditing={isEditing}
      isActive={isActive}
      isFocused={isFocused}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => onSelect?.(connection.id, e)}
      onDoubleClick={() => onConnect(connection)}
      bulkContextMenuItems={bulkContextMenuItems}
      contextMenuItems={contextMenuItems}
    >
      <div className="relative shrink-0">
        <ConnectionAvatar connection={connection} size={isList ? 28 : 48} />
        {showPingDot && (
          <span className="absolute bottom-0 right-0">
            {pingStatus === "up" && (
              <span
                className="absolute inset-0 rounded-full animate-ping-slow"
                style={{ background: "var(--t-status-connected)" }}
              />
            )}
            <span
              className="relative block rounded-full border-2 border-[var(--t-bg-card)]"
              style={{
                width: 11,
                height: 11,
                background: pingStatus === "up"
                  ? "var(--t-status-connected)"
                  : pingStatus === "down"
                  ? "var(--t-status-error)"
                  : "var(--t-text-dim)",
              }}
            />
          </span>
        )}
      </div>

      {isList ? (
        <>
          <p className="font-medium-bold truncate w-48 shrink-0 text-[var(--t-text-bright)]">
            {displayName(connection)}
          </p>
          <p className="text-xs truncate flex-1 text-[var(--t-text-secondary)]">
            {connection.username}@{connection.host}:{connection.port}
          </p>
          {connection.tags.length > 0 && (
            <div className="flex items-center gap-1 shrink-0">
              {connection.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-1.5 py-0.5 rounded text-xs bg-[var(--t-bg-elevated)] text-[var(--t-text-muted)] border border-[var(--t-border)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 min-w-0">
          <p className="text-base font-medium-bold truncate leading-tight text-[var(--t-text-bright)]">
            {displayName(connection)}
          </p>
          <p className="text-xs mt-0.5 truncate text-[var(--t-text-secondary)]">
            ssh, {connection.username}
          </p>
        </div>
      )}

      <div className="flex items-center gap-1 shrink-0">
        {!isSynced && (
          <span title="Cloud sync disabled" className="text-[var(--t-text-dim)] flex items-center">
            <Icon icon="lucide:cloud-off" width={18} />
          </span>
        )}
        {canEdit && <CardActionButton icon="lucide:pencil" title="Edit" onClick={() => onEdit(connection)} />}
        {canEdit && <CardActionButton icon="lucide:trash-2" title="Delete" onClick={() => onDelete(connection.id)} danger />}
        <button
          onClick={(e) => { e.stopPropagation(); onConnect(connection); }}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors hover:text-[var(--t-tab-active-text)]"
          title="Connect (or double-click)"
        >
          <Icon icon="lucide:terminal" width={18} />
        </button>
      </div>
    </BaseCard>
  );
}
