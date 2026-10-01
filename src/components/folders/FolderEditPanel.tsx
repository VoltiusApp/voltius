import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { useAutosave } from "@/hooks/useAutosave";
import { useSyncPrefsStore } from "@/stores/syncPrefsStore";
import {
  PanelShell,
  PanelHeader,
  FormSection,
  formInputClass,
  formInputStyle,
  formLabelClass,
  formLabelStyle,
} from "@/components/shared/Panel";
import { PanelActionsMenu } from "@/components/shared/PanelActionsMenu";
import { PinButton } from "@/components/shared/PinButton";
import { VaultPicker } from "@/components/shared/VaultPicker";
import FolderSelector from "@/components/shared/FolderSelector";
import { PermissionsSection } from "@/components/permissions/PermissionsSection";
import { RuleSetMoveCancelled } from "@/services/teamObjectPersistence";
import { clipboardMenuItems } from "@/utils/clipboardMenuItems";
import { buildFolderMenuItems } from "@/utils/folderMenuItems";
import { useFolderPin } from "./useFolderPin";
import { ReadOnlyFields, withEditAccess, type EditAccessProps } from "@/components/shared/editAccess";
import type { Folder, FolderFormData, VaultOption } from "@/types";

interface FolderEditPanelProps {
  folder: Folder;
  onUpdate: (id: string, data: FolderFormData) => void | Promise<void>;
  onDelete: (folder: Folder) => void;
  onExport?: () => void;
  onShare?: () => void;
  onClose: () => void;
  onOpen: () => void;
  onSelectSelf: () => void;
  parentOptions?: Folder[];
  vaults?: VaultOption[];
  onMoveToVault?: (vaultId: string) => void;
  onCopyToVault?: (vaultId: string) => void;
  /** Sync object type used to check per-object and global sync state. Defaults to "folder". */
  syncObjectType?: string;
}

export const FolderEditPanel = withEditAccess("folder", (p: FolderEditPanelProps) => p.folder, FolderEditPanelEditor);

function FolderEditPanelEditor({
  folder,
  onUpdate,
  onDelete,
  onExport,
  onShare,
  onClose,
  onOpen,
  onSelectSelf,
  parentOptions,
  vaults,
  onMoveToVault,
  onCopyToVault,
  syncObjectType = "folder",
  readOnly,
}: FolderEditPanelProps & EditAccessProps) {
  const { t } = useTranslation();
  const [name, setName]         = useState(folder.name);
  const [vaultId, setVaultId]   = useState(folder.vault_id ?? "personal");
  const [parentId, setParentId] = useState<string | null>(folder.parent_folder_id ?? null);
  const isSynced     = useSyncPrefsStore((s) => s.isObjectSynced(folder.id, syncObjectType));
  const toggleExcluded = useSyncPrefsStore((s) => s.toggleExcluded);
  const pin = useFolderPin(folder, !readOnly);

  useEffect(() => {
    setName(folder.name);
    setVaultId(folder.vault_id ?? "personal");
    setParentId(folder.parent_folder_id ?? null);
  }, [folder.id, folder.name, folder.vault_id, folder.parent_folder_id]);

  const buildFormData = (overrides?: Partial<FolderFormData>): FolderFormData => ({
    name: name.trim() || folder.name,
    object_type: folder.object_type,
    parent_folder_id: parentId ?? undefined,
    vault_id: vaultId,
    ...overrides,
  });

  const { schedule, markDirty, flushAndClose, saveState } = useAutosave({
    onSave: () => onUpdate(folder.id, buildFormData()),
    canSave: () => !!name.trim(),
    readOnly,
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [name]);

  const handleClose = () => flushAndClose(onClose);

  const handleVaultChange = (id: string) => {
    setVaultId(id);
    // Vault changes save immediately (not autosaved) to avoid race with folder.id
    onUpdate(folder.id, buildFormData({ vault_id: id }));
  };

  const handleParentChange = (id: string | null) => {
    setParentId(id);
    void Promise.resolve(onUpdate(folder.id, buildFormData({ parent_folder_id: id ?? undefined }))).catch((err) => {
      if (!(err instanceof RuleSetMoveCancelled)) throw err;
      setParentId(folder.parent_folder_id ?? null);
    });
  };

  const menuItems = buildFolderMenuItems({
    t,
    onOpen,
    pinItem: pin.pinItem,
    pinTeamItem: pin.pinTeamItem,
    onExport,
    onShare,
    vaults,
    canEdit: !readOnly,
    onMoveToVault,
    onCopyToVault,
    clipboard: clipboardMenuItems(t).map((i) => ({ ...i, onClick: () => { flushSync(onSelectSelf); i.onClick?.(); } })),
    isSynced,
    onToggleSync: () => toggleExcluded(folder.id),
    onDelete: () => onDelete(folder),
  });

  return (
    <PanelShell>
      <PanelHeader
        icon="lucide:pencil"
        title={t("folders.editPanel.title")}
        subtitle={<VaultPicker vaultId={vaultId} onChange={handleVaultChange} disabled={readOnly} />}
        onClose={handleClose}
        saveState={saveState}
        actions={<><PinButton pinned={pin.effPinned} onToggle={pin.togglePin} /><PanelActionsMenu items={menuItems} /></>}
      />
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        <ReadOnlyFields readOnly={readOnly}>
        <FormSection label={t("folders.editPanel.general")}>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>{t("folders.editPanel.nameLabel")}</label>
            <input className={formInputClass} style={formInputStyle} value={name}
              onChange={(e) => { markDirty(); setName(e.target.value); }}
              onKeyDown={(e) => e.key === "Escape" && setName(folder.name)} />
          </div>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>{t("folders.editPanel.parentLabel")}</label>
            <FolderSelector value={parentId} folders={(parentOptions ?? []).filter((f) => (f.vault_id ?? "personal") === vaultId)} onChange={handleParentChange} />
          </div>
        </FormSection>
        </ReadOnlyFields>
        <PermissionsSection objectId={folder.id} vaultId={folder.vault_id} type={syncObjectType === "snippet" ? "snippet_folder" : "folder"} />
      </div>
    </PanelShell>
  );
}
