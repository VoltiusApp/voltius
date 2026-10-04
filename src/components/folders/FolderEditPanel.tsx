import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import { useAutosave } from "@/hooks/useAutosave";
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
import { IconTileButton } from "@/components/shared/IconTileButton";
import { PinButton } from "@/components/shared/PinButton";
import { VaultPicker } from "@/components/shared/VaultPicker";
import FolderSelector from "@/components/shared/FolderSelector";
import { PermissionsSection } from "@/components/permissions/PermissionsSection";
import { revertIfMoveCancelled } from "@/services/teamObjectPersistence";
import { clipboardMenuItems } from "@/utils/clipboardMenuItems";
import { buildFolderMenuItems } from "@/utils/folderMenuItems";
import { FolderAppearancePicker, folderIcon, type FolderAppearance } from "./folderAppearance";
import { useFolderPin } from "./useFolderPin";
import { useFolderSync } from "./useFolderSync";
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
  readOnly,
}: FolderEditPanelProps & EditAccessProps) {
  const { t } = useTranslation();
  const [name, setName]         = useState(folder.name);
  const [vaultId, setVaultId]   = useState(folder.vault_id ?? "personal");
  const [parentId, setParentId] = useState<string | null>(folder.parent_folder_id ?? null);
  const [appearance, setAppearance] = useState<FolderAppearance>({ color: folder.color, icon: folder.icon });
  const [showAppearance, setShowAppearance] = useState(false);
  const nameRowRef = useRef<HTMLDivElement>(null);
  const sync = useFolderSync(folder);
  const pin = useFolderPin(folder, !readOnly);

  useEffect(() => {
    setName(folder.name);
    setVaultId(folder.vault_id ?? "personal");
    setParentId(folder.parent_folder_id ?? null);
    setAppearance({ color: folder.color, icon: folder.icon });
  }, [folder.id, folder.name, folder.vault_id, folder.parent_folder_id, folder.color, folder.icon]);

  const buildFormData = (overrides?: Partial<FolderFormData>): FolderFormData => ({
    name: name.trim() || folder.name,
    object_type: folder.object_type,
    parent_folder_id: parentId ?? undefined,
    vault_id: vaultId,
    color: appearance.color,
    icon: appearance.icon,
    ...overrides,
  });

  const { schedule, markDirty, flushAndClose, saveState } = useAutosave({
    onSave: () => onUpdate(folder.id, buildFormData()),
    canSave: () => !!name.trim(),
    readOnly,
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [name, appearance]);

  const handleClose = () => flushAndClose(onClose);

  const handleVaultChange = (id: string) => {
    setVaultId(id);
    // Vault changes save immediately (not autosaved) to avoid race with folder.id
    onUpdate(folder.id, buildFormData({ vault_id: id }));
  };

  const handleParentChange = (id: string | null) => {
    setParentId(id);
    void Promise.resolve(onUpdate(folder.id, buildFormData({ parent_folder_id: id ?? undefined })))
      .catch(revertIfMoveCancelled(() => setParentId(folder.parent_folder_id ?? null)));
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
    ...sync,
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
            <div ref={nameRowRef} className="relative flex gap-2.5">
              <IconTileButton
                icon={folderIcon(appearance)}
                base={appearance.color}
                title={t("folders.appearance.change")}
                ariaLabel={t("folders.appearance.change")}
                onClick={() => setShowAppearance((v) => !v)}
              />
              <input className={formInputClass} style={formInputStyle} value={name}
                onChange={(e) => { markDirty(); setName(e.target.value); }}
                onKeyDown={(e) => e.key === "Escape" && setName(folder.name)} />
              <FolderAppearancePicker
                open={showAppearance}
                onClose={() => setShowAppearance(false)}
                anchorRef={nameRowRef}
                value={appearance}
                onChange={(next) => { markDirty(); setAppearance(next); }}
              />
            </div>
          </div>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>{t("folders.editPanel.parentLabel")}</label>
            <FolderSelector value={parentId} folders={(parentOptions ?? []).filter((f) => (f.vault_id ?? "personal") === vaultId)} onChange={handleParentChange} />
          </div>
        </FormSection>
        </ReadOnlyFields>
        <PermissionsSection objectId={folder.id} vaultId={folder.vault_id} type={pin.folderType} />
      </div>
    </PanelShell>
  );
}
