import { useCallback, useMemo } from "react";
import { Icon } from "@iconify/react";
import { AvatarTile } from "@/components/shared/AvatarTile";
import { BaseCard } from "@/components/shared/BaseCard";
import { CardActionButton } from "@/components/shared/CardActionButton";
import { TagBadge } from "@/components/shared/TagBadge";
import type { LayoutMode } from "@/components/shared/ToolbarViewControls";
import type { SshKey, Identity, VaultOption } from "@/types";
import { useUIContributions } from "@/hooks/useUIContributions";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import type { ContextMenuItem } from "@/components/shared/ContextMenu";
import { usePermissions } from "@/hooks/usePermission";
import { vaultMenuItems } from "@/utils/vaultMenuItems";
import { getShortcutHint } from "@/stores/shortcutStore";
import { useKeyStore } from "@/stores/keyStore";
import { useIdentityStore } from "@/stores/identityStore";
import { useTeamStore } from "@/stores/teamStore";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";

// ─────────────────────────────────────────────────────────────────
// Small shared display components
// ─────────────────────────────────────────────────────────────────

export function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center gap-2">
      <p className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
        {label}
      </p>
      {count > 0 && (
        <span
          className="text-xs px-1.5 py-0.5 rounded-md bg-(--t-bg-elevated) text-(--t-text-dim)"
        >
          {count}
        </span>
      )}
    </div>
  );
}

export function DraftCard({ icon, label }: { icon: string; label: string }) {
  return (
    <div
      className="flex items-center gap-4 px-4 py-4 rounded-2xl border-2 border-dashed border-(--t-accent) opacity-50"
    >
      <AvatarTile icon={icon} iconSize={24} className="rounded-lg w-[3.2rem] h-[3.2rem]" iconClassName="text-(--t-text-dim)" />
      <p className="text-sm font-medium text-(--t-text-dim)">{label}</p>
    </div>
  );
}

export function EmptySection({
  icon, title, description, buttonLabel, onAdd,
}: {
  icon: string;
  title: string;
  description: string;
  buttonLabel: string;
  onAdd?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center py-8 gap-3">
      <div
        className="w-12 h-12 rounded-xl flex items-center justify-center bg-(--t-bg-toolbar) border border-(--t-border)"
      >
        <Icon icon={icon} width={20} className="text-(--t-text-dim)" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium mb-1 text-(--t-text-primary)">{title}</p>
        <p className="text-xs text-(--t-text-dim)">{description}</p>
      </div>
      {onAdd && <button
        onClick={onAdd}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors bg-(--t-bg-elevated) text-(--t-accent) border border-(--t-border-hover)"
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--t-border-hover)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "var(--t-bg-elevated)")}
      >
        <Icon icon="lucide:plus" width={13} />
        {buttonLabel}
      </button>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// SSH Key cards
// ─────────────────────────────────────────────────────────────────

export function KeyCardContent({ sshKey, avatarSize, iconSize, isList }: { sshKey: SshKey; avatarSize: number; iconSize: number; isList?: boolean }) {
  const formattedDate = new Date(sshKey.created_at).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
  const avatar = (
    <AvatarTile icon="lucide:key-round" iconSize={iconSize} size={avatarSize} className="rounded-lg" />
  );
  const keyType = sshKey.key_type && (
    <span className="text-xs px-1.5 py-0.5 rounded-sm font-mono shrink-0 bg-(--t-bg-elevated) text-(--t-accent)">
      {sshKey.key_type}
    </span>
  );

  if (isList) {
    return (
      <>
        {avatar}
        <p className="text-sm font-medium-bold truncate w-52 shrink-0 text-(--t-text-bright)">
          {sshKey.name}
        </p>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {keyType}
          <span className="text-xs text-(--t-text-secondary) shrink-0">{formattedDate}</span>
        </div>
        {sshKey.tags.length > 0 && (
          <div className="flex items-center gap-1 shrink-0 max-w-40 overflow-hidden">
            {sshKey.tags.slice(0, 3).map((tag) => <TagBadge key={tag} tag={tag} />)}
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {avatar}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate text-(--t-text-bright)">
          {sshKey.name}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {keyType}
          <span className="text-xs text-(--t-text-secondary)">{formattedDate}</span>
        </div>
        {sshKey.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {sshKey.tags.map((tag) => <TagBadge key={tag} tag={tag} />)}
          </div>
        )}
      </div>
    </>
  );
}

function KeyCard({
  sshKey, canEdit, vaults, isEditing, isSelected, isFocused, layoutMode,
  onEdit, onDelete, onSelect, onExport, onMoveToVault, onCopyToVault,
  bulkContextMenuItems, onSectionPointerDown,
}: {
  sshKey: SshKey;
  canEdit: boolean;
  vaults: VaultOption[];
  isEditing: boolean;
  isSelected: boolean;
  isFocused?: boolean;
  layoutMode: LayoutMode;
  onEdit: (k: SshKey) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onExport: (k: SshKey) => void;
  onMoveToVault?: (key: SshKey, vaultId: string) => void;
  onCopyToVault?: (key: SshKey, vaultId: string) => void;
  bulkContextMenuItems?: ContextMenuItem[];
  onSectionPointerDown?: (e: React.PointerEvent<HTMLDivElement>, id: string) => void;
}) {
  const isList = layoutMode === "list";
  const avatarSize = isList ? 28 : 48;
  const iconSize = isList ? 14 : 24;
  const formattedDate = new Date(sshKey.created_at).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
  const contributions = useUIContributions("key.contextMenu", sshKey);
  const isSynced = useSyncPrefsStore((s) => s.isObjectSynced(sshKey.id, "key"));
  const pinKey = useKeyStore((s) => s.pinKey);
  const pinKeyForTeam = useKeyStore((s) => s.pinKeyForTeam);
  const effPinned = useEffectivePinned(sshKey, "key");
  const pinSource = useEffectivePinSource(sshKey, "key");
  const isTeamVault = useTeamStore((s) => s.teams.some((t) => t.id === sshKey.vault_id));

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => [
    ...(canEdit ? [{ label: "Edit", icon: "lucide:pencil", onClick: () => onEdit(sshKey), shortcut: "E" }] : []),
    { label: "Add to host", icon: "lucide:square-arrow-right", onClick: () => onExport(sshKey) },
    {
      label: isTeamVault
        ? (pinSource === "personal" || pinSource === "team+personal")
          ? "Unpin for me"
          : pinSource === "team-hidden"
          ? "Show in my view"
          : pinSource === "team"
          ? "Hide for me"
          : "Pin for me"
        : effPinned ? "Unpin" : "Pin",
      icon: (pinSource === "personal" || pinSource === "team+personal" || (!isTeamVault && effPinned))
        ? "lucide:pin-off"
        : "lucide:pin",
      onClick: () => {
        if (!isTeamVault) {
          pinKey(sshKey.id, !effPinned).catch(() => {});
        } else {
          pinKey(sshKey.id, nextPersonalPinValue(pinSource)).catch(() => {});
        }
      },
      divider: true as const,
    },
    ...(canEdit && isTeamVault ? [{
      label: sshKey.pinned ? "Unpin for team" : "Pin for team",
      icon: "lucide:users",
      onClick: () => pinKeyForTeam(sshKey.id, !sshKey.pinned).catch(() => {}),
    }] : []),
    ...contributions.map((a, i) => ({ ...a, icon: a.icon ?? "lucide:chevron-right", divider: i === 0 })),
    ...vaultMenuItems(vaults, canEdit,
      (vId) => onMoveToVault?.(sshKey, vId),
      (vId) => onCopyToVault?.(sshKey, vId),
    ),
    {
      label: isSynced ? "Disable cloud sync" : "Enable cloud sync",
      icon: isSynced ? "lucide:cloud-off" : "lucide:cloud",
      onClick: () => useSyncPrefsStore.getState().toggleExcluded(sshKey.id),
      divider: true,
    },
    ...(canEdit ? [{ label: "Delete", icon: "lucide:trash-2", onClick: () => onDelete(sshKey.id), danger: true, shortcut: getShortcutHint("delete") }] : []),
  ], [canEdit, sshKey, contributions, vaults, isSynced, pinKey, pinKeyForTeam, effPinned, pinSource, isTeamVault, onEdit, onDelete, onExport, onMoveToVault, onCopyToVault]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => onSectionPointerDown?.(e, sshKey.id),
    [onSectionPointerDown, sshKey.id],
  );

  return (
    <BaseCard
      data-card
      isList={isList}
      glass={!isList}
      isEditing={isEditing}
      isSelected={isSelected}
      isFocused={isFocused}
      data-selectable-id={sshKey.id}
      onPointerDown={onSectionPointerDown ? handlePointerDown : undefined}
      onClick={(e) => onSelect(sshKey.id, e)}
      onDoubleClick={() => onEdit(sshKey)}
      bulkContextMenuItems={bulkContextMenuItems}
      contextMenuItems={contextMenuItems}
    >
      {isList ? (
        <>
          <KeyCardContent sshKey={sshKey} avatarSize={avatarSize} iconSize={iconSize} isList />
          <div className="flex items-center gap-1 shrink-0">
            {!isSynced && (
              <span title="Cloud sync disabled" className="text-(--t-text-dim) flex items-center">
                <Icon icon="lucide:cloud-off" width={18} />
              </span>
            )}
            {canEdit && <CardActionButton icon="lucide:pencil" title="Edit" onClick={() => onEdit(sshKey)} />}
            {canEdit && <CardActionButton icon="lucide:trash-2" title="Delete" onClick={() => onDelete(sshKey.id)} danger />}
          </div>
        </>
      ) : (
        <div className="flex-1 min-w-0 self-start flex flex-col gap-2.5">
          <div className="flex items-start gap-2 min-w-0">
            <AvatarTile icon="lucide:key-round" iconSize={16} size={30} className="rounded-lg" />
            <div className="flex flex-col gap-0.5 flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-sm font-bold truncate flex-1 min-w-0 text-(--t-text-bright)">
                  {sshKey.name}
                </p>
                {sshKey.key_type && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[11px] font-mono bg-(--t-bg-input) text-(--t-text-dim) border border-(--t-border)">
                    {sshKey.key_type}
                  </span>
                )}
                {!isSynced && (
                  <span title="Cloud sync disabled" className="shrink-0 text-(--t-text-dim) flex items-center">
                    <Icon icon="lucide:cloud-off" width={14} />
                  </span>
                )}
              </div>
              <p className="text-xs truncate text-(--t-text-muted)">added {formattedDate}</p>
            </div>
          </div>

          {(sshKey.tags.length > 0 || canEdit) && (
            <div className="flex items-center justify-between gap-2 -mt-0.5">
              <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                {sshKey.tags.slice(0, 3).map((tag) => (
                  <TagBadge key={tag} tag={tag} className="rounded-md shrink-0 py-0 text-[10px]" />
                ))}
                {sshKey.tags.length > 3 && (
                  <span className="text-[10px] text-(--t-text-dim) shrink-0">+{sshKey.tags.length - 3}</span>
                )}
              </div>
              {canEdit && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <CardActionButton icon="lucide:pencil" title="Edit" reveal={false} onClick={() => onEdit(sshKey)} />
                  <CardActionButton icon="lucide:trash-2" title="Delete" danger reveal={false} onClick={() => onDelete(sshKey.id)} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </BaseCard>
  );
}

export function KeySection({
  keys, showDraft, editingId, selectedIdSet, focusedId, layoutMode,
  vaultOptions, label,
  onAdd, onEdit, onDelete, onSelect, onExport,
  onMoveToVault, onCopyToVault,
  bulkContextMenuItems, onPointerDown,
}: {
  keys: SshKey[];
  showDraft: boolean;
  editingId: string | null;
  selectedIdSet: Set<string>;
  focusedId?: string | null;
  layoutMode: LayoutMode;
  /** All available vault options (id = storedId / teamId or "personal") */
  vaultOptions?: VaultOption[];
  label?: string;
  onAdd?: () => void;
  onEdit: (k: SshKey) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onExport: (k: SshKey) => void;
  onMoveToVault?: (key: SshKey, vaultId: string) => void;
  onCopyToVault?: (key: SshKey, vaultId: string) => void;
  bulkContextMenuItems?: ContextMenuItem[];
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>, id: string) => void;
}) {
  // usePermissions called ONCE at section level, not per card
  const can = usePermissions();

  const otherVaultsMap = useMemo(() => {
    const map: Record<string, VaultOption[]> = {};
    const opts = vaultOptions ?? [];
    for (const k of keys) {
      const vid = k.vault_id ?? "personal";
      if (!map[vid]) map[vid] = opts.filter((v) => v.id !== vid);
    }
    return map;
  }, [vaultOptions, keys]);

  if (keys.length === 0 && !showDraft) {
    return (
      <EmptySection
        icon="lucide:key-round"
        title="No SSH keys yet"
        description="Store reusable SSH key pairs"
        buttonLabel="Add Key"
        onAdd={onAdd}
      />
    );
  }

  const gridClass = layoutMode === "grid"
    ? "grid gap-4 mt-3"
    : "flex flex-col gap-1 mt-3";

  return (
    <div>
      <SectionHeader label={label ?? "SSH Keys"} count={keys.length} />
      <div className={gridClass} style={layoutMode === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" } : undefined}>
        {showDraft && <DraftCard icon="lucide:key-round" label="New Key" />}
        {keys.map((k) => {
          const vaultId = k.vault_id ?? "personal";
          const canEdit = can("EDIT_KEYS", vaultId);
          return (
            <KeyCard
              key={k.id}
              sshKey={k}
              canEdit={canEdit}
              vaults={otherVaultsMap[vaultId] ?? []}
              isEditing={editingId === k.id}
              isSelected={selectedIdSet.has(k.id)}
              isFocused={focusedId === k.id}
              layoutMode={layoutMode}
              onEdit={onEdit}
              onDelete={onDelete}
              onSelect={onSelect}
              onExport={onExport}
              onMoveToVault={onMoveToVault}
              onCopyToVault={onCopyToVault}
              bulkContextMenuItems={bulkContextMenuItems}
              onSectionPointerDown={onPointerDown}
            />
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Identity cards
// ─────────────────────────────────────────────────────────────────

function IdentityCard({
  identity, linkedKey, canEdit, vaults,
  isEditing, isSelected, isFocused, layoutMode,
  onEdit, onDelete, onSelect, onMoveToVault, onCopyToVault,
  bulkContextMenuItems, onSectionPointerDown,
}: {
  identity: Identity;
  linkedKey: SshKey | undefined;
  canEdit: boolean;
  vaults: VaultOption[];
  isEditing: boolean;
  isSelected: boolean;
  isFocused?: boolean;
  layoutMode: LayoutMode;
  onEdit: (i: Identity) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onMoveToVault?: (identity: Identity, vaultId: string) => void;
  onCopyToVault?: (identity: Identity, vaultId: string) => void;
  bulkContextMenuItems?: ContextMenuItem[];
  onSectionPointerDown?: (e: React.PointerEvent<HTMLDivElement>, id: string) => void;
}) {
  const contributions = useUIContributions("identity.contextMenu", identity);
  const isSynced = useSyncPrefsStore((s) => s.isObjectSynced(identity.id, "identity"));
  const pinIdentity = useIdentityStore((s) => s.pinIdentity);
  const pinIdentityForTeam = useIdentityStore((s) => s.pinIdentityForTeam);
  const effPinned = useEffectivePinned(identity, "identity");
  const pinSource = useEffectivePinSource(identity, "identity");
  const isTeamVault = useTeamStore((s) => s.teams.some((t) => t.id === identity.vault_id));
  const formattedDate = new Date(identity.created_at).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });

  const isList = layoutMode === "list";
  const avatarSize = isList ? 28 : 48;
  const iconSize = isList ? 14 : 24;

  const contextMenuItems = useMemo<ContextMenuItem[]>(() => [
    ...(canEdit ? [{ label: "Edit", icon: "lucide:pencil", onClick: () => onEdit(identity), shortcut: "E" }] : []),
    {
      label: isTeamVault
        ? (pinSource === "personal" || pinSource === "team+personal")
          ? "Unpin for me"
          : pinSource === "team-hidden"
          ? "Show in my view"
          : pinSource === "team"
          ? "Hide for me"
          : "Pin for me"
        : effPinned ? "Unpin" : "Pin",
      icon: (pinSource === "personal" || pinSource === "team+personal" || (!isTeamVault && effPinned))
        ? "lucide:pin-off"
        : "lucide:pin",
      onClick: () => {
        if (!isTeamVault) {
          pinIdentity(identity.id, !effPinned).catch(() => {});
        } else {
          pinIdentity(identity.id, nextPersonalPinValue(pinSource)).catch(() => {});
        }
      },
      divider: true as const,
    },
    ...(canEdit && isTeamVault ? [{
      label: identity.pinned ? "Unpin for team" : "Pin for team",
      icon: "lucide:users",
      onClick: () => pinIdentityForTeam(identity.id, !identity.pinned).catch(() => {}),
    }] : []),
    ...contributions.map((a, i) => ({ ...a, icon: a.icon ?? "lucide:chevron-right", divider: i === 0 })),
    ...vaultMenuItems(vaults, canEdit,
      (vId) => onMoveToVault?.(identity, vId),
      (vId) => onCopyToVault?.(identity, vId),
    ),
    {
      label: isSynced ? "Disable cloud sync" : "Enable cloud sync",
      icon: isSynced ? "lucide:cloud-off" : "lucide:cloud",
      onClick: () => useSyncPrefsStore.getState().toggleExcluded(identity.id),
      divider: true,
    },
    ...(canEdit ? [{ label: "Delete", icon: "lucide:trash-2", onClick: () => onDelete(identity.id), danger: true, shortcut: getShortcutHint("delete") }] : []),
  ], [canEdit, identity, contributions, vaults, isSynced, pinIdentity, pinIdentityForTeam, effPinned, pinSource, isTeamVault, onEdit, onDelete, onMoveToVault, onCopyToVault]);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => onSectionPointerDown?.(e, identity.id),
    [onSectionPointerDown, identity.id],
  );

  return (
    <BaseCard
      data-card
      data-selectable-id={identity.id}
      isList={isList}
      glass={!isList}
      isEditing={isEditing}
      isSelected={isSelected}
      isFocused={isFocused}
      onPointerDown={onSectionPointerDown ? handlePointerDown : undefined}
      onClick={(e) => onSelect(identity.id, e)}
      onDoubleClick={() => onEdit(identity)}
      bulkContextMenuItems={bulkContextMenuItems}
      contextMenuItems={contextMenuItems}
    >
      <AvatarTile icon="lucide:id-card" iconSize={iconSize} size={avatarSize} className="rounded-lg" />

      {isList ? (
        <>
          <p className="text-sm font-medium-bold truncate w-52 shrink-0 text-(--t-text-bright)">
            {identity.name ?? identity.username}
          </p>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {identity.name && (
              <span className="text-xs truncate text-(--t-text-secondary)">
                {identity.username}
              </span>
            )}
            {linkedKey ? (
              <span className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-sm shrink-0 bg-(--t-bg-elevated) text-(--t-text-dim)">
                <Icon icon="lucide:key-round" width={10} />
                {linkedKey.name ?? "Key"}
              </span>
            ) : (
              <span className="text-xs px-1.5 py-0.5 rounded-sm shrink-0 bg-(--t-bg-elevated) text-(--t-text-dim)">
                Password
              </span>
            )}
            <span className="text-xs text-(--t-text-secondary) shrink-0">{formattedDate}</span>
          </div>
          {identity.tags.length > 0 && (
            <div className="flex items-center gap-1 shrink-0 max-w-40 overflow-hidden">
              {identity.tags.slice(0, 3).map((tag) => <TagBadge key={tag} tag={tag} />)}
            </div>
          )}
        </>
      ) : (
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate text-(--t-text-bright)">
            {identity.name ?? identity.username}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            {identity.name && (
              <span className="text-xs truncate text-(--t-text-secondary)">
                {identity.username}
              </span>
            )}
            {linkedKey && (
              <span
                className="flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-sm bg-(--t-bg-elevated) text-(--t-text-dim)"
              >
                <Icon icon="lucide:key-round" width={10} />
                {linkedKey.name ?? "Key"}
              </span>
            )}
            {!linkedKey && (
              <span
                className="text-xs px-1.5 py-0.5 rounded-sm bg-(--t-bg-elevated) text-(--t-text-dim)"
              >
                Password
              </span>
            )}
            <span className="text-xs text-(--t-text-secondary)">{formattedDate}</span>
          </div>
          {identity.tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {identity.tags.map((tag) => <TagBadge key={tag} tag={tag} />)}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-1 shrink-0">
        {!isSynced && (
          <span title="Cloud sync disabled" className="text-(--t-text-dim) flex items-center">
            <Icon icon="lucide:cloud-off" width={18} />
          </span>
        )}
        {canEdit && <CardActionButton icon="lucide:pencil" title="Edit" onClick={() => onEdit(identity)} />}
        {canEdit && <CardActionButton icon="lucide:trash-2" title="Delete" onClick={() => onDelete(identity.id)} danger />}
      </div>
    </BaseCard>
  );
}

export function IdentitySection({
  identities, keys, showDraft, editingId, selectedIdSet, focusedId, layoutMode,
  vaultOptions, label,
  onAdd, onEdit, onDelete, onSelect,
  onMoveToVault, onCopyToVault,
  bulkContextMenuItems, onPointerDown,
}: {
  identities: Identity[];
  keys: SshKey[];
  showDraft: boolean;
  editingId: string | null;
  selectedIdSet: Set<string>;
  focusedId?: string | null;
  layoutMode: LayoutMode;
  vaultOptions?: VaultOption[];
  label?: string;
  onAdd?: () => void;
  onEdit: (i: Identity) => void;
  onDelete: (id: string) => void;
  onSelect: (id: string, e: React.MouseEvent<HTMLDivElement>) => void;
  onMoveToVault?: (identity: Identity, vaultId: string) => void;
  onCopyToVault?: (identity: Identity, vaultId: string) => void;
  bulkContextMenuItems?: ContextMenuItem[];
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>, id: string) => void;
}) {
  // usePermissions called ONCE at section level, not per card
  const can = usePermissions();

  const linkedKeyMap = useMemo(() => {
    const map: Record<string, SshKey> = {};
    for (const k of keys) map[k.id] = k;
    return map;
  }, [keys]);

  const otherVaultsMap = useMemo(() => {
    const map: Record<string, VaultOption[]> = {};
    const opts = vaultOptions ?? [];
    for (const i of identities) {
      const vid = i.vault_id ?? "personal";
      if (!map[vid]) map[vid] = opts.filter((v) => v.id !== vid);
    }
    return map;
  }, [vaultOptions, identities]);

  if (identities.length === 0 && !showDraft) {
    return (
      <EmptySection
        icon="lucide:users"
        title="No identities yet"
        description="Combine a username with credentials for reuse across hosts"
        buttonLabel="Add Identity"
        onAdd={onAdd}
      />
    );
  }

  const gridClass = layoutMode === "grid"
    ? "grid gap-4 mt-3"
    : "flex flex-col gap-1 mt-3";

  return (
    <div>
      <SectionHeader label={label ?? "Identities"} count={identities.length} />
      <div className={gridClass} style={layoutMode === "grid" ? { gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" } : undefined}>
        {showDraft && <DraftCard icon="lucide:id-card" label="New Identity" />}
        {identities.map((i) => {
          const vaultId = i.vault_id ?? "personal";
          const canEdit = can("EDIT_IDENTITIES", vaultId);
          return (
            <IdentityCard
              key={i.id}
              identity={i}
              linkedKey={linkedKeyMap[i.key_id ?? ""]}
              canEdit={canEdit}
              vaults={otherVaultsMap[vaultId] ?? []}
              isEditing={editingId === i.id}
              isSelected={selectedIdSet.has(i.id)}
              isFocused={focusedId === i.id}
              layoutMode={layoutMode}
              onEdit={onEdit}
              onDelete={onDelete}
              onSelect={onSelect}
              onMoveToVault={onMoveToVault}
              onCopyToVault={onCopyToVault}
              bulkContextMenuItems={bulkContextMenuItems}
              onSectionPointerDown={onPointerDown}
            />
          );
        })}
      </div>
    </div>
  );
}
