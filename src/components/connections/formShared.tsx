import { useState, type ReactNode } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { Connection } from "@/types";
import { useConnectionStore } from "@/stores/connectionStore";
import { clearRememberedVars } from "@/stores/hostCommandVarsStore";
import {
  useVaultObjectFormShell,
  type VaultObjectFormShell,
} from "@/components/shared/vaultObjectForm";
import EncodingSelector from "./EncodingSelector";
import { HostCommandField } from "./HostCommandField";

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

/** The connection forms' shell: the shared chrome bound to the connection store. */
export function useConnectionFormShell(initial?: Connection): VaultObjectFormShell {
  const pinConnection = useConnectionStore((s) => s.pinConnection);
  return useVaultObjectFormShell({ initial, folderType: "connection", objectType: "connection", pin: pinConnection });
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
