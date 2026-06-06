import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import type { Connection, ConnectionFormData, VaultOption } from "@/types";
import { useAutosave } from "@/hooks/useAutosave";
import { useFolderStore } from "@/stores/folderStore";
import { useDefaultVaultId, resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { serialListPorts } from "@/services/serial";
import FolderSelector from "@/components/shared/FolderSelector";
import TagSelector from "@/components/shared/TagSelector";
import { PanelActionsMenu } from "@/components/shared/PanelActionsMenu";
import { PinButton } from "@/components/shared/PinButton";
import { useConnectionStore } from "@/stores/connectionStore";
import { useTeamStore } from "@/stores/teamStore";
import {
  useEffectivePinned,
  useEffectivePinSource,
  nextPersonalPinValue,
} from "@/hooks/useEffectivePinned";
import { VaultPicker } from "@/components/shared/VaultPicker";
import {
  PanelShell,
  PanelHeader,
  FormSection,
  formInputClass,
  formInputStyle,
  formLabelClass,
  formLabelStyle,
} from "@/components/shared/Panel";
import { Pills } from "@/components/shared/Pills";
import { FormSelect } from "@/components/shared/FormSelect";
import { PortInput } from "@/components/shared/PortInput";
import EncodingSelector from "./EncodingSelector";
import type { ConnectionFormHandle } from "./ConnectionForm";

const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

interface Props {
  initial?: Connection;
  onSubmit: (data: ConnectionFormData, password: string | null, privateKey: string | null, passphrase: string | null) => void | Promise<void>;
  onClose: () => void;
  onDuplicate?: () => void;
  onConnect?: () => void;
  onDelete?: () => void;
  vaults?: VaultOption[];
  canEdit?: boolean;
  onMoveToVault?: (vaultId: string) => void;
  onCopyToVault?: (vaultId: string) => void;
}

// VaultOption imported for type completeness; onMoveToVault/onCopyToVault
// reserved for future vault move UI (matching ConnectionForm API).

const SerialConnectionForm = forwardRef<ConnectionFormHandle, Props>(function SerialConnectionForm(
  { initial, onSubmit, onClose, onDuplicate, onConnect, onDelete, canEdit },
  ref,
) {
  const [name, setName] = useState(initial?.name ?? "");
  const [serialPort, setSerialPort] = useState(initial?.serial_port ?? "");
  const [baud, setBaud] = useState<number>(initial?.serial_baud ?? 115200);
  const [customBaud, setCustomBaud] = useState("");
  const [useCustomBaud, setUseCustomBaud] = useState(
    initial?.serial_baud !== undefined && !BAUD_RATES.includes(initial.serial_baud),
  );
  const [dataBits, setDataBits] = useState<number>(initial?.serial_data_bits ?? 8);
  const [parity, setParity] = useState(initial?.serial_parity ?? "none");
  const [stopBits, setStopBits] = useState<number>(initial?.serial_stop_bits ?? 1);
  const [flowControl, setFlowControl] = useState(initial?.serial_flow_control ?? "none");
  const [preCommand, setPreCommand] = useState(initial?.pre_command ?? "");
  const [postCommand, setPostCommand] = useState(initial?.post_command ?? "");
  const [terminalEncoding, setTerminalEncoding] = useState(initial?.terminal_encoding ?? "");
  const [showAdvanced, setShowAdvanced] = useState(
    !!(
      initial?.pre_command ||
      initial?.post_command ||
      initial?.terminal_encoding ||
      (initial?.serial_data_bits !== undefined && initial.serial_data_bits !== 8) ||
      (initial?.serial_parity !== undefined && initial.serial_parity !== "none") ||
      (initial?.serial_stop_bits !== undefined && initial.serial_stop_bits !== 1) ||
      (initial?.serial_flow_control !== undefined && initial.serial_flow_control !== "none")
    ),
  );
  const [tags, setTags] = useState<string[]>(initial?.tags ?? []);
  const [folderId, setFolderId] = useState<string | null>(initial?.folder_id ?? null);
  const [availablePorts, setAvailablePorts] = useState<{ name: string; path: string }[]>([]);

  const defaultVaultId = useDefaultVaultId();
  const [vaultId, setVaultId] = useState<string>(() => initial?.vault_id ?? defaultVaultId);
  const vaultPickerTouched = useRef(false);
  const isNew = !initial;
  useEffect(() => {
    if (isNew && !vaultPickerTouched.current) {
      setVaultId(defaultVaultId);
    }
  }, [isNew, defaultVaultId]);

  const userEditedRef = useRef(false);
  const { folders, loadFolders, saveFolder } = useFolderStore();
  const pinConnection = useConnectionStore((s) => s.pinConnection);
  const effPinned = useEffectivePinned(initial ?? { id: "", pinned: false }, "connection");
  const pinSource = useEffectivePinSource(initial ?? { id: "", pinned: false }, "connection");
  const isPinned = effPinned;
  const isTeamVault = useTeamStore((s) => initial ? s.teams.some((t) => t.id === initial.vault_id) : false);

  useEffect(() => {
    void loadFolders();
    serialListPorts()
      .then(setAvailablePorts)
      .catch(() => {});
  }, [loadFolders]);

  const effectiveBaud = useCustomBaud ? (parseInt(customBaud, 10) || 115200) : baud;

  const buildSubmit = () => {
    return {
      data: {
        name: name.trim() || undefined,
        connection_type: "serial" as const,
        serial_port: serialPort.trim() || undefined,
        serial_baud: effectiveBaud,
        serial_data_bits: dataBits,
        serial_parity: parity,
        serial_stop_bits: stopBits,
        serial_flow_control: flowControl,
        tags,
        folder_id: folderId ?? undefined,
        vault_id: resolveVaultIdForSave(vaultId),
        pre_command: preCommand.trim() || undefined,
        post_command: postCommand.trim() || undefined,
        terminal_encoding: terminalEncoding || undefined,
        // Serial connections don't use these SSH fields; provide empty defaults
        host: "",
        port: 0,
        username: "",
        auth_type: "password" as const,
      } as ConnectionFormData,
      password: null,
      privateKey: null,
    };
  };

  const { schedule, markDirty: _markDirty, flushAndClose, flush, saveState } = useAutosave({
    onSave: () => {
      const { data, password: pwd, privateKey: pk } = buildSubmit();
      return onSubmit(data, pwd, pk, null) ?? undefined;
    },
    canSave: () => !!serialPort.trim(),
  });
  const markDirty = useCallback(() => {
    userEditedRef.current = true;
    _markDirty();
  }, [_markDirty]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [name, serialPort, baud, customBaud, useCustomBaud, dataBits, parity, stopBits, flowControl, preCommand, postCommand, terminalEncoding, tags, folderId, vaultId]);

  useImperativeHandle(ref, () => ({ flush, isDirty: () => userEditedRef.current }), [flush]);

  const handleClose = () => flushAndClose(onClose);

  const panelItems = initial
    ? [
        ...(onConnect ? [{ label: "Connect", icon: "lucide:terminal", onClick: () => onConnect() }] : []),
        ...(onDuplicate ? [{ label: "Duplicate", icon: "lucide:copy", onClick: () => onDuplicate(), divider: true as const }] : []),
        ...(canEdit && onDelete ? [{ label: "Delete", icon: "lucide:trash-2", onClick: () => onDelete(), danger: true as const, divider: true as const }] : []),
      ]
    : [];

  return (
    <PanelShell>
      <PanelHeader
        icon={initial ? "lucide:pencil" : "lucide:ethernet-port"}
        title={initial ? "Edit Serial Host" : "New Serial Host"}
        subtitle={<VaultPicker vaultId={vaultId} onChange={(id) => { vaultPickerTouched.current = true; setVaultId(id); markDirty(); }} />}
        onClose={handleClose}
        saveState={initial ? saveState : undefined}
        actions={initial ? (
          <>
            <PinButton pinned={isPinned} onToggle={() => {
              if (!isTeamVault) {
                pinConnection(initial.id, !isPinned).catch(() => {});
              } else {
                pinConnection(initial.id, nextPersonalPinValue(pinSource)).catch(() => {});
              }
            }} />
            {panelItems.length > 0 && <PanelActionsMenu items={panelItems} />}
          </>
        ) : undefined}
      />

      <div className="flex flex-col flex-1 overflow-y-auto">
        <div className="flex-1 px-4 py-4 space-y-3">

          <FormSection label="General">
            <div>
              <label className={formLabelClass} style={formLabelStyle}>Label</label>
              <input
                className={formInputClass}
                style={formInputStyle}
                value={name}
                onChange={(e) => { markDirty(); setName(e.target.value); }}
                placeholder="My Device (optional)"
              />
            </div>
            <div>
              <label className={formLabelClass} style={formLabelStyle}>Tags</label>
              <TagSelector
                value={tags}
                vaultId={vaultId}
                onChange={(next) => { markDirty(); setTags(next); }}
              />
            </div>
            <div>
              <label className={formLabelClass} style={formLabelStyle}>Folder</label>
              <FolderSelector
                value={folderId}
                folders={folders}
                onChange={(id) => { markDirty(); setFolderId(id); }}
                onCreateFolder={async (name) => {
                  const folder = await saveFolder({ name, object_type: "connection", vault_id: resolveVaultIdForSave(vaultId) || undefined });
                  markDirty();
                  setFolderId(folder.id);
                  return folder.id;
                }}
              />
            </div>
          </FormSection>

          <FormSection label="Serial Port">
            <div>
              <label className={formLabelClass} style={formLabelStyle}>
                Port <span className="text-(--t-accent)">*</span>
              </label>
              <PortInput
                value={serialPort}
                ports={availablePorts}
                onChange={(v) => { markDirty(); setSerialPort(v); }}
              />
            </div>

            <div>
              <label className={formLabelClass} style={formLabelStyle}>Baud Rate</label>
              {!useCustomBaud ? (
                <div className="flex gap-2">
                  <FormSelect
                    className="flex-1"
                    value={String(baud)}
                    options={BAUD_RATES.map((r) => ({ value: String(r), label: r.toLocaleString() }))}
                    onChange={(v) => { markDirty(); setBaud(Number(v)); }}
                  />
                  <button
                    type="button"
                    className="text-xs text-(--t-text-dim) hover:text-(--t-text-primary) px-2 transition-colors whitespace-nowrap"
                    onClick={() => { setUseCustomBaud(true); setCustomBaud(String(baud)); }}
                  >
                    Custom
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    className={`${formInputClass} flex-1`}
                    style={formInputStyle}
                    value={customBaud}
                    onChange={(e) => { markDirty(); setCustomBaud(e.target.value.replace(/\D/g, "")); }}
                    placeholder="115200"
                  />
                  <button
                    type="button"
                    className="text-xs text-(--t-text-dim) hover:text-(--t-text-primary) px-2 transition-colors whitespace-nowrap"
                    onClick={() => { setUseCustomBaud(false); setBaud(115200); }}
                  >
                    Preset
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="flex items-center gap-1.5 text-xs text-(--t-text-dim) hover:text-(--t-text-primary) transition-colors w-full pt-1"
            >
              <span>Advanced</span>
              {!showAdvanced && (preCommand || postCommand || terminalEncoding || dataBits !== 8 || parity !== "none" || stopBits !== 1 || flowControl !== "none") && (
                <span className="ml-0.5 w-1.5 h-1.5 rounded-full bg-(--t-accent)" />
              )}
              <Icon icon={showAdvanced ? "lucide:chevron-up" : "lucide:chevron-down"} width={12} className="ml-auto" />
            </button>
            <div
              className="grid transition-[grid-template-rows] duration-200 ease-out"
              style={{ gridTemplateRows: showAdvanced ? "1fr" : "0fr", marginTop: showAdvanced ? undefined : 0 }}
            >
              <div className="overflow-hidden">
                <div className="space-y-3 mt-3">
                  <div>
                    <label className={formLabelClass} style={formLabelStyle}>Data Bits</label>
                    <Pills
                      options={[
                        { value: "5", label: "5" },
                        { value: "6", label: "6" },
                        { value: "7", label: "7" },
                        { value: "8", label: "8" },
                      ]}
                      value={String(dataBits)}
                      onChange={(v) => { markDirty(); setDataBits(Number(v)); }}
                    />
                  </div>

                  <div>
                    <label className={formLabelClass} style={formLabelStyle}>Stop Bits</label>
                    <Pills
                      options={[
                        { value: "1", label: "1" },
                        { value: "2", label: "2" },
                      ]}
                      value={String(stopBits)}
                      onChange={(v) => { markDirty(); setStopBits(Number(v)); }}
                    />
                  </div>

                  <div>
                    <label className={formLabelClass} style={formLabelStyle}>Parity</label>
                    <Pills
                      options={[
                        { value: "none", label: "None" },
                        { value: "even", label: "Even" },
                        { value: "odd", label: "Odd" },
                      ]}
                      value={parity}
                      onChange={(v) => { markDirty(); setParity(v); }}
                    />
                  </div>

                  <div>
                    <label className={formLabelClass} style={formLabelStyle}>Flow Control</label>
                    <Pills
                      options={[
                        { value: "none", label: "None" },
                        { value: "xon-xoff", label: "XON/XOFF" },
                        { value: "rts-cts", label: "RTS/CTS" },
                      ]}
                      value={flowControl}
                      onChange={(v) => { markDirty(); setFlowControl(v); }}
                    />
                  </div>

                  <div className="relative">
                    <Icon icon="lucide:play" width={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--t-text-dim) pointer-events-none" />
                    <input
                      className={`${formInputClass} text-xs pl-7`}
                      style={formInputStyle}
                      value={preCommand}
                      onChange={(e) => { markDirty(); setPreCommand(e.target.value); }}
                      placeholder="Pre Command"
                    />
                  </div>
                  <div className="relative">
                    <Icon icon="lucide:square" width={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-(--t-text-dim) pointer-events-none" />
                    <input
                      className={`${formInputClass} text-xs pl-7`}
                      style={formInputStyle}
                      value={postCommand}
                      onChange={(e) => { markDirty(); setPostCommand(e.target.value); }}
                      placeholder="Post Command"
                    />
                  </div>
                  <EncodingSelector
                    value={terminalEncoding}
                    onChange={(v) => { markDirty(); setTerminalEncoding(v); }}
                  />
                </div>
              </div>
            </div>
          </FormSection>
        </div>
      </div>
    </PanelShell>
  );
});

export default SerialConnectionForm;
export type { ConnectionFormHandle as SerialConnectionFormHandle };
