import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { Folder, FolderFormData } from "@/types";
import { useFolderStore } from "@/stores/folderStore";
import { useTeamStore } from "@/stores/teamStore";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";
import { useDefaultVaultId, resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { folderOptionsFor } from "@/utils/folderTree";
import FolderSelector from "@/components/shared/FolderSelector";
import TagSelector from "@/components/shared/TagSelector";
import { formInputClass, formInputStyle, formLabelClass, formLabelStyle } from "@/components/shared/Panel";

/** The subset of an edited object the shared form chrome reads. */
interface EditedObject {
  id: string;
  vault_id?: string;
  pinned?: boolean;
  favorite?: boolean;
}

type PinObjectType = Parameters<typeof useEffectivePinned>[1];

export interface VaultObjectFormShell {
  vaultId: string;
  /** Vault chosen in the picker; also flags the form as no longer following the default. */
  pickVault: (id: string, markDirty: () => void) => void;
  folderOptions: Folder[];
  saveFolder: (data: FolderFormData) => Promise<Folder>;
  isPinned: boolean;
  togglePin: () => void;
}

/**
 * The chrome every vault-object side panel carries: which vault the object is
 * being saved to, the folder options for its object type, and the pin toggle —
 * a team object pins through the personal override, a personal one through the
 * raw flag.
 */
export function useVaultObjectFormShell({
  initial,
  folderType,
  objectType,
  pin,
}: {
  initial?: EditedObject;
  folderType: Parameters<typeof folderOptionsFor>[1];
  objectType: PinObjectType;
  pin: (id: string, pinned: boolean | null) => Promise<void>;
}): VaultObjectFormShell {
  const defaultVaultId = useDefaultVaultId();
  const [vaultId, setVaultId] = useState<string>(() => initial?.vault_id ?? defaultVaultId);
  const vaultPickerTouched = useRef(false);
  const isNew = !initial;
  useEffect(() => {
    if (isNew && !vaultPickerTouched.current) {
      setVaultId(defaultVaultId);
    }
  }, [isNew, defaultVaultId]);

  const { folders, loadFolders, saveFolder } = useFolderStore();
  const folderOptions = useMemo(() => folderOptionsFor(folders, folderType), [folders, folderType]);
  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  const pinnable = initial ?? { id: "", pinned: false };
  const isPinned = useEffectivePinned(pinnable, objectType);
  const pinSource = useEffectivePinSource(pinnable, objectType);
  const isTeamVault = useTeamStore((s) => (initial ? s.teams.some((team) => team.id === initial.vault_id) : false));
  const togglePin = useCallback(() => {
    if (!initial) return;
    pin(initial.id, isTeamVault ? nextPersonalPinValue(pinSource) : !isPinned).catch(() => {});
  }, [initial, isPinned, isTeamVault, pin, pinSource]);

  const pickVault = useCallback((id: string, markDirty: () => void) => {
    vaultPickerTouched.current = true;
    setVaultId(id);
    markDirty();
  }, []);

  return { vaultId, pickVault, folderOptions, saveFolder, isPinned, togglePin };
}

interface TagsAndFolderFieldsProps {
  shell: VaultObjectFormShell;
  /** i18n namespace holding `tags` and `folder`, e.g. `connections.common`. */
  tPrefix: string;
  folderType: Parameters<typeof folderOptionsFor>[1];
  tags: string[];
  onChangeTags: (next: string[]) => void;
  folderId: string | null;
  onChangeFolderId: (id: string | null) => void;
  markDirty: () => void;
}

/** The tags + folder pair every object form ends its General section with. */
export function TagsAndFolderFields({
  shell,
  tPrefix,
  folderType,
  tags,
  onChangeTags,
  folderId,
  onChangeFolderId,
  markDirty,
}: TagsAndFolderFieldsProps) {
  const { t } = useTranslation();
  const { vaultId, folderOptions, saveFolder } = shell;
  return (
    <>
      <div>
        <label className={formLabelClass} style={formLabelStyle}>{t(`${tPrefix}.tags`)}</label>
        <TagSelector
          value={tags}
          vaultId={vaultId}
          onChange={(next) => { markDirty(); onChangeTags(next); }}
        />
      </div>
      <div>
        <label className={formLabelClass} style={formLabelStyle}>{t(`${tPrefix}.folder`)}</label>
        <FolderSelector
          value={folderId}
          folders={folderOptions}
          onChange={(id) => { markDirty(); onChangeFolderId(id); }}
          onCreateFolder={async (name) => {
            const folder = await saveFolder({ name, object_type: folderType, vault_id: resolveVaultIdForSave(vaultId) || undefined });
            markDirty();
            onChangeFolderId(folder.id);
            return folder.id;
          }}
        />
      </div>
    </>
  );
}

/** A password/passphrase input with the reveal button every form shows. */
export function SecretInput({
  value,
  onChange,
  placeholder,
  show,
  onToggleShow,
  autoComplete,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  show: boolean;
  onToggleShow: () => void;
  autoComplete?: string;
  className?: string;
}) {
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        className={`${formInputClass} pr-9${className ? ` ${className}` : ""}`}
        style={formInputStyle}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button
        type="button"
        onClick={onToggleShow}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors text-(--t-text-dim)"
        onMouseEnter={(e) => { e.currentTarget.style.color = "var(--t-text-primary)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "var(--t-text-dim)"; }}
        tabIndex={-1}
      >
        <Icon icon={show ? "lucide:eye-off" : "lucide:eye"} width={14} />
      </button>
    </div>
  );
}
