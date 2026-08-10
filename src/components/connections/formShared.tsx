import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { Connection, FolderFormData, Folder } from "@/types";
import { useConnectionStore } from "@/stores/connectionStore";
import { useFolderStore } from "@/stores/folderStore";
import { useTeamStore } from "@/stores/teamStore";
import { clearRememberedVars } from "@/stores/hostCommandVarsStore";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";
import { useDefaultVaultId, resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { folderOptionsFor } from "@/utils/folderTree";
import FolderSelector from "@/components/shared/FolderSelector";
import TagSelector from "@/components/shared/TagSelector";
import EncodingSelector from "./EncodingSelector";
import { HostCommandField } from "./HostCommandField";
import { formLabelClass, formLabelStyle } from "@/components/shared/Panel";

export interface ConnectionFormProps {
  initial?: Connection;
  onSubmit: (
    data: import("@/types").ConnectionFormData,
    password: string | null,
    privateKey: string | null,
    passphrase: string | null,
  ) => void | Promise<void>;
  onClose: () => void;
  onDuplicate?: () => void;
  onConnect?: () => void;
  onDelete?: () => void;
  /** Other vaults available for move/copy (excludes the connection's current vault) */
  vaults?: import("@/types").VaultOption[];
  canEdit?: boolean;
  onMoveToVault?: (vaultId: string) => void;
  onCopyToVault?: (vaultId: string) => void;
}

export interface ConnectionFormHandle {
  flush: () => void;
  isDirty: () => boolean;
}

export interface ConnectionFormShell {
  vaultId: string;
  pickVault: (id: string, markDirty: () => void) => void;
  userEditedRef: React.RefObject<boolean>;
  folderOptions: Parameters<typeof FolderSelector>[0]["folders"];
  saveFolder: (data: FolderFormData) => Promise<Folder>;
  isPinned: boolean;
  togglePin: () => void;
}

/**
 * The chrome both connection forms carry: the edited vault, the connection
 * folder options, and the pin toggle (a team object pins through the personal
 * override, a personal one through the raw flag).
 */
export function useConnectionFormShell(initial?: Connection): ConnectionFormShell {
  const defaultVaultId = useDefaultVaultId();
  const [vaultId, setVaultId] = useState<string>(() => initial?.vault_id ?? defaultVaultId);
  const vaultPickerTouched = useRef(false);
  const userEditedRef = useRef(false);
  const isNew = !initial;
  useEffect(() => {
    if (isNew && !vaultPickerTouched.current) {
      setVaultId(defaultVaultId);
    }
  }, [isNew, defaultVaultId]);

  const { folders, loadFolders, saveFolder } = useFolderStore();
  const folderOptions = useMemo(() => folderOptionsFor(folders, "connection"), [folders]);
  useEffect(() => {
    void loadFolders();
  }, [loadFolders]);

  const pinConnection = useConnectionStore((s) => s.pinConnection);
  const pinnable = initial ?? { id: "", pinned: false };
  const isPinned = useEffectivePinned(pinnable, "connection");
  const pinSource = useEffectivePinSource(pinnable, "connection");
  const isTeamVault = useTeamStore((s) => (initial ? s.teams.some((team) => team.id === initial.vault_id) : false));
  const togglePin = useCallback(() => {
    if (!initial) return;
    const next = isTeamVault ? nextPersonalPinValue(pinSource) : !isPinned;
    pinConnection(initial.id, next).catch(() => {});
  }, [initial, isPinned, isTeamVault, pinConnection, pinSource]);

  const pickVault = useCallback((id: string, markDirty: () => void) => {
    vaultPickerTouched.current = true;
    setVaultId(id);
    markDirty();
  }, []);

  return {
    vaultId,
    pickVault,
    userEditedRef,
    folderOptions,
    saveFolder,
    isPinned,
    togglePin,
  };
}

interface TagsAndFolderFieldsProps {
  shell: ConnectionFormShell;
  tags: string[];
  onChangeTags: (next: string[]) => void;
  folderId: string | null;
  onChangeFolderId: (id: string | null) => void;
  markDirty: () => void;
}

/** The tags + connection-folder pair at the bottom of both forms' General section. */
export function TagsAndFolderFields({
  shell,
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
        <label className={formLabelClass} style={formLabelStyle}>{t("connections.common.tags")}</label>
        <TagSelector
          value={tags}
          vaultId={vaultId}
          onChange={(next) => { markDirty(); onChangeTags(next); }}
        />
      </div>
      <div>
        <label className={formLabelClass} style={formLabelStyle}>{t("connections.common.folder")}</label>
        <FolderSelector
          value={folderId}
          folders={folderOptions}
          onChange={(id) => { markDirty(); onChangeFolderId(id); }}
          onCreateFolder={async (name) => {
            const folder = await saveFolder({ name, object_type: "connection", vault_id: resolveVaultIdForSave(vaultId) || undefined });
            markDirty();
            onChangeFolderId(folder.id);
            return folder.id;
          }}
        />
      </div>
    </>
  );
}

interface AdvancedDisclosureProps {
  open: boolean;
  onToggle: () => void;
  /** Show the dot that says the collapsed block holds non-default values. */
  hasValues: boolean;
  children: ReactNode;
}

/** The "Advanced" toggle plus the grid-rows collapse both forms animate with. */
export function AdvancedDisclosure({ open, onToggle, hasValues, children }: AdvancedDisclosureProps) {
  const { t } = useTranslation();
  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        className="flex items-center gap-1.5 text-xs text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors w-full pt-1"
      >
        <span>{t("connections.common.advanced")}</span>
        {!open && hasValues && <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-(--t-accent)" />}
        <Icon icon={open ? "lucide:chevron-up" : "lucide:chevron-down"} width={12} className="ml-auto" />
      </button>
      <div
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? "1fr" : "0fr", marginTop: open ? undefined : 0 }}
      >
        <div className="overflow-hidden">
          <div className="space-y-3 mt-3">{children}</div>
        </div>
      </div>
    </>
  );
}

export interface HostCommandFieldsState {
  preCommand: string;
  postCommand: string;
  preSnippetId?: string;
  postSnippetId?: string;
  askVarsEachTime: boolean;
  terminalEncoding: string;
  setPreCommand: (v: string) => void;
  setPostCommand: (v: string) => void;
  setPreSnippetId: (v: string | undefined) => void;
  setPostSnippetId: (v: string | undefined) => void;
  setAskVarsEachTime: (v: boolean) => void;
  setTerminalEncoding: (v: string) => void;
}

/** The pre/post command state both forms keep and submit. */
export function useHostCommandFields(initial?: Connection): HostCommandFieldsState {
  const [preCommand, setPreCommand] = useState(initial?.pre_command ?? "");
  const [postCommand, setPostCommand] = useState(initial?.post_command ?? "");
  const [preSnippetId, setPreSnippetId] = useState(initial?.pre_snippet_id);
  const [postSnippetId, setPostSnippetId] = useState(initial?.post_snippet_id);
  const [askVarsEachTime, setAskVarsEachTime] = useState(initial?.ask_vars_each_time ?? false);
  const [terminalEncoding, setTerminalEncoding] = useState(initial?.terminal_encoding ?? "");
  return {
    preCommand, postCommand, preSnippetId, postSnippetId, askVarsEachTime, terminalEncoding,
    setPreCommand, setPostCommand, setPreSnippetId, setPostSnippetId, setAskVarsEachTime, setTerminalEncoding,
  };
}

/** True when the collapsed advanced block holds a host command or an encoding. */
export function hostCommandFieldsSet(f: HostCommandFieldsState): boolean {
  return !!(f.preCommand || f.postCommand || f.preSnippetId || f.postSnippetId || f.terminalEncoding);
}

interface HostCommandFieldsProps {
  connectionId?: string;
  fields: HostCommandFieldsState;
  markDirty: () => void;
}

/** Pre/post host commands, the ask-vars-each-time opt-in, and the encoding picker. */
export function HostCommandFields({ connectionId, fields, markDirty }: HostCommandFieldsProps) {
  const { t } = useTranslation();
  return (
    <>
      <HostCommandField
        slot="pre"
        text={fields.preCommand}
        snippetId={fields.preSnippetId}
        onChangeText={(v) => { markDirty(); fields.setPreCommand(v); }}
        onChangeSnippetId={(v) => { markDirty(); fields.setPreSnippetId(v); }}
      />
      <HostCommandField
        slot="post"
        text={fields.postCommand}
        snippetId={fields.postSnippetId}
        onChangeText={(v) => { markDirty(); fields.setPostCommand(v); }}
        onChangeSnippetId={(v) => { markDirty(); fields.setPostSnippetId(v); }}
      />
      {(fields.preSnippetId || fields.postSnippetId) && (
        <label className="flex items-center gap-2 text-xs text-(--t-text-dim)">
          <input
            type="checkbox"
            checked={fields.askVarsEachTime}
            onChange={(e) => {
              markDirty();
              fields.setAskVarsEachTime(e.target.checked);
              if (e.target.checked && connectionId) clearRememberedVars(connectionId);
            }}
          />
          {t("connections.common.hostCommand.askEachTime")}
        </label>
      )}
      <EncodingSelector
        value={fields.terminalEncoding}
        onChange={(v) => { markDirty(); fields.setTerminalEncoding(v); }}
      />
    </>
  );
}
