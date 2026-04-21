import type { VaultOption } from "@/types";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { vaultMenuItems } from "@/utils/vaultMenuItems";
import { getShortcutHint } from "@/stores/shortcutStore";

export interface ConnectionMenuOptions {
  canEdit?: boolean;
  contributions: ContextMenuItem[];
  vaults?: VaultOption[];
  isSynced: boolean;
  pingDisabled: boolean;
  connectShortcut?: string;
  duplicateShortcut?: string;
  onConnect: () => void;
  onDuplicate?: () => void;
  onMoveToVault?: (vaultId: string) => void;
  onCopyToVault?: (vaultId: string) => void;
  onToggleSync: () => void;
  onTogglePing: () => void;
  onDelete?: () => void;
  /** Items inserted between Duplicate and contributions (e.g. Pin for HostCard) */
  extras?: ContextMenuItem[];
}

export function buildConnectionMenuItems({
  canEdit,
  contributions,
  vaults,
  isSynced,
  pingDisabled,
  connectShortcut,
  duplicateShortcut,
  onConnect,
  onDuplicate,
  onMoveToVault,
  onCopyToVault,
  onToggleSync,
  onTogglePing,
  onDelete,
  extras = [],
}: ConnectionMenuOptions): ContextMenuItem[] {
  return [
    { label: "Connect", icon: "lucide:terminal", onClick: onConnect, shortcut: connectShortcut },
    ...(canEdit && onDuplicate ? [{ label: "Duplicate", icon: "lucide:copy", onClick: onDuplicate, shortcut: duplicateShortcut }] : []),
    ...extras,
    ...contributions.map((a, i) => ({ ...a, divider: i === 0 })),
    ...vaultMenuItems(vaults, canEdit, onMoveToVault, onCopyToVault),
    {
      label: isSynced ? "Disable cloud sync" : "Enable cloud sync",
      icon: isSynced ? "lucide:cloud-off" : "lucide:cloud",
      onClick: onToggleSync,
      divider: true,
    },
    {
      label: pingDisabled ? "Enable reachability check" : "Disable reachability check",
      icon: pingDisabled ? "lucide:wifi" : "lucide:wifi-off",
      onClick: onTogglePing,
    },
    ...(onDelete ? [{ label: "Delete", icon: "lucide:trash-2", onClick: onDelete, danger: true, shortcut: getShortcutHint("delete") }] : []),
  ];
}
