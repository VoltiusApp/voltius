import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useAutosave } from "@/hooks/useAutosave";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import { PanelShell, PanelHeader } from "@/components/shared/Panel";
import { PanelActionsMenu } from "@/components/shared/PanelActionsMenu";
import { VaultPicker } from "@/components/shared/VaultPicker";
import { vaultMenuItems } from "@/utils/vaultMenuItems";
import type { Folder, FolderFormData, VaultOption } from "@/types";

interface FolderEditPanelProps {
  folder: Folder;
  onUpdate: (id: string, data: FolderFormData) => void;
  onDelete: (folder: Folder) => void;
  onExport?: () => void;
  onClose: () => void;
  vaults?: VaultOption[];
  canEdit?: boolean;
  onMoveToVault?: (vaultId: string) => void;
  onCopyToVault?: (vaultId: string) => void;
  /** Sync object type used to check per-object and global sync state. Defaults to "folder". */
  syncObjectType?: string;
}

export function FolderEditPanel({
  folder,
  onUpdate,
  onDelete,
  onExport,
  onClose,
  vaults,
  canEdit,
  onMoveToVault,
  onCopyToVault,
  syncObjectType = "folder",
}: FolderEditPanelProps) {
  const [name, setName]       = useState(folder.name);
  const [vaultId, setVaultId] = useState(folder.vault_id ?? "personal");
  const isSynced     = useSyncPrefsStore((s) => s.isObjectSynced(folder.id, syncObjectType));
  const toggleExcluded = useSyncPrefsStore((s) => s.toggleExcluded);
  const isTypeSynced = useSyncPrefsStore((s) => s.isTypeSynced(syncObjectType));

  // Reset when switching to a different folder
  useEffect(() => {
    setName(folder.name);
    setVaultId(folder.vault_id ?? "personal");
  }, [folder.id, folder.name, folder.vault_id]);

  const buildFormData = (overrides?: Partial<FolderFormData>): FolderFormData => ({
    name: name.trim() || folder.name,
    object_type: folder.object_type,
    parent_folder_id: folder.parent_folder_id,
    vault_id: vaultId,
    ...overrides,
  });

  const { schedule, markDirty, flushAndClose, saveState } = useAutosave({
    onSave: () => onUpdate(folder.id, buildFormData()),
    canSave: () => !!name.trim(),
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [name]);

  const handleClose = () => flushAndClose(onClose);

  const handleVaultChange = (id: string) => {
    setVaultId(id);
    // Vault changes save immediately (not autosaved) to avoid race with folder.id
    onUpdate(folder.id, buildFormData({ vault_id: id }));
  };

  const panelActions = [
    ...(onExport ? [{ label: "Export folder", icon: "lucide:upload", onClick: onExport }] : []),
    ...vaultMenuItems(vaults, canEdit, onMoveToVault, onCopyToVault),
    {
      label: isSynced ? "Disable cloud sync" : "Enable cloud sync",
      icon: isSynced ? "lucide:cloud-off" : "lucide:cloud",
      onClick: () => toggleExcluded(folder.id),
    },
  ];

  return (
    <PanelShell>
      <PanelHeader
        icon="lucide:folder"
        title="Folder"
        subtitle={<VaultPicker vaultId={vaultId} onChange={handleVaultChange} />}
        onClose={handleClose}
        saveState={saveState}
        actions={<PanelActionsMenu items={panelActions} />}
      />

      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-5">
        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">Name</label>
          <input
            className="form-input w-full px-3 py-2 rounded-lg text-sm outline-hidden bg-(--t-bg-input) border border-(--t-border) text-(--t-text-bright)"
            value={name}
            onChange={(e) => { markDirty(); setName(e.target.value); }}
            onKeyDown={(e) => e.key === "Escape" && setName(folder.name)}
          />
        </div>

        {/* Cloud sync */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">Cloud Sync</label>
          <button
            className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors bg-(--t-bg-input) border border-(--t-border) ${isTypeSynced ? "cursor-pointer" : "cursor-default"}`}
            style={{ opacity: isTypeSynced ? 1 : 0.5 }}
            onClick={() => { if (isTypeSynced) toggleExcluded(folder.id); }}
          >
            <div className="flex items-center gap-2">
              <Icon
                icon={isSynced ? "lucide:cloud" : "lucide:cloud-off"}
                width={15}
                style={{ color: isSynced ? "var(--t-accent)" : "var(--t-text-dim)" }}
              />
              <span className="text-sm text-(--t-text-primary)">
                {isSynced ? "Synced to cloud" : "Not synced"}
              </span>
            </div>
            <div
              className="w-8 h-4 rounded-full transition-colors relative"
              style={{ background: isSynced ? "var(--t-accent)" : "var(--t-border-hover)" }}
            >
              <div
                className="absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all"
                style={{ left: isSynced ? "calc(100% - 14px)" : "2px" }}
              />
            </div>
          </button>
          {!isTypeSynced && (
            <p className="text-xs text-(--t-text-dim)">
              Folder sync is disabled globally in Settings → Cloud Sync.
            </p>
          )}
        </div>

        {/* Meta */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">Created</label>
          <p className="text-sm text-(--t-text-secondary)">
            {new Date(folder.created_at).toLocaleString()}
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-t-(--t-border)">
        <button
          className="flex items-center gap-2 w-full justify-center px-3 py-2 rounded-lg text-sm transition-colors text-(--t-danger)"
          style={{
            background: "transparent",
            border: "1px solid color-mix(in srgb, var(--t-danger) 40%, transparent)",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "color-mix(in srgb, var(--t-danger) 8%, transparent)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          onClick={() => onDelete(folder)}
        >
          <Icon icon="lucide:trash-2" width={14} />
          Delete folder
        </button>
      </div>
    </PanelShell>
  );
}
