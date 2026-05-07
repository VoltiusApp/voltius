import { Icon } from "@iconify/react";
import { BaseCard } from "@/components/shared/BaseCard";
import { vaultMenuItems } from "@/utils/vaultMenuItems";
import { getShortcutHint } from "@/stores/shortcutStore";
import type { KnownHost, VaultOption } from "@/types";

interface KnownHostCardProps {
  host: KnownHost;
  isSelected?: boolean;
  isFocused?: boolean;
  isList?: boolean;
  canEdit?: boolean;
  otherVaults?: VaultOption[];
  onSelect?: (e: React.MouseEvent) => void;
  onDelete?: () => void;
  onMoveVault?: (vaultId: string) => void;
  onCopyVault?: (vaultId: string) => void;
}

function truncateFingerprint(fp: string): string {
  // SHA256:xxxx... → keep prefix + first 16 chars of hash
  const colonIdx = fp.indexOf(":");
  if (colonIdx !== -1) {
    const algo = fp.slice(0, colonIdx + 1);
    const hash = fp.slice(colonIdx + 1);
    return algo + (hash.length > 16 ? hash.slice(0, 16) + "…" : hash);
  }
  return fp.length > 22 ? fp.slice(0, 22) + "…" : fp;
}

export function KnownHostCard({
  host,
  isSelected,
  isFocused,
  isList,
  canEdit,
  otherVaults,
  onSelect,
  onDelete,
  onMoveVault,
  onCopyVault,
}: KnownHostCardProps) {
  const contextMenuItems = [
    ...vaultMenuItems(otherVaults, canEdit, onMoveVault, onCopyVault),
    ...(canEdit && onDelete
      ? [{ label: "Delete", icon: "lucide:trash-2", danger: true, divider: true, onClick: onDelete, shortcut: getShortcutHint("delete") }]
      : []),
  ];

  const bulkContextMenuItems = [
    ...(canEdit && onDelete
      ? [{ label: "Delete", icon: "lucide:trash-2", danger: true, onClick: onDelete, shortcut: getShortcutHint("delete") }]
      : []),
  ];

  return (
    <BaseCard
      isSelected={isSelected}
      isFocused={isFocused}
      isList={isList}
      onClick={onSelect}
      contextMenuItems={contextMenuItems}
      bulkContextMenuItems={bulkContextMenuItems}
      data-selectable-id={host.id}
    >
      {/* Fingerprint icon */}
      <div className="w-10 h-10 rounded-xl bg-[var(--t-bg-card-avatar)] flex items-center justify-center shrink-0">
        <Icon icon="lucide:fingerprint" width={18} />
      </div>

      <div className="min-w-0 flex-1">
        {isList ? (
          /* List layout */
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-[var(--t-text-primary)] truncate">
                {host.name ?? `${host.host}:${host.port}`}
              </p>
              {host.name && (
                <p className="text-xs text-[var(--t-text-dim)] truncate">
                  {host.host}:{host.port}
                </p>
              )}
            </div>
            <p className="text-xs text-[var(--t-text-dim)] font-mono shrink-0 hidden md:block">
              {truncateFingerprint(host.fingerprint)}
            </p>
          </div>
        ) : (
          /* Grid layout */
          <>
            <p className="text-sm font-medium text-[var(--t-text-primary)] truncate">
              {host.name ?? `${host.host}:${host.port}`}
            </p>
            {host.name && (
              <p className="text-xs text-[var(--t-text-dim)] truncate mt-0.5">
                {host.host}:{host.port}
              </p>
            )}
            <p className="text-xs text-[var(--t-text-dim)] font-mono truncate mt-1">
              {truncateFingerprint(host.fingerprint)}
            </p>
          </>
        )}
      </div>

      {/* Delete action (visible on hover) */}
      {canEdit && onDelete && (
        <button
          className="shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-[var(--t-text-dim)] opacity-0 group-hover:opacity-100 transition-opacity hover:text-status-error hover:bg-status-error/10"
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete"
          type="button"
        >
          <Icon icon="lucide:trash-2" width={14} />
        </button>
      )}
    </BaseCard>
  );
}
