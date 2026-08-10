import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ConnectionFormData } from "@/types";
import { useAutosave } from "@/hooks/useAutosave";
import { resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { serialListPorts } from "@/services/serial";
import { PanelActionsMenu } from "@/components/shared/PanelActionsMenu";
import { PinButton } from "@/components/shared/PinButton";
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
import {
  AdvancedDisclosure,
  HostCommandFields,
  hostCommandFieldsSet,
  useHostCommandFields,
  TagsAndFolderFields,
  useConnectionFormShell,
  type ConnectionFormHandle,
  type ConnectionFormProps,
} from "./formShared";

const BAUD_RATES = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600];

const SerialConnectionForm = forwardRef<ConnectionFormHandle, ConnectionFormProps>(function SerialConnectionForm(
  { initial, onSubmit, onClose, onDuplicate, onConnect, onDelete, canEdit },
  ref,
) {
  const { t } = useTranslation();
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
  const hostCommands = useHostCommandFields(initial);
  const [showAdvanced, setShowAdvanced] = useState(
    !!(
      initial?.pre_command ||
      initial?.post_command ||
      initial?.pre_snippet_id ||
      initial?.post_snippet_id ||
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

  const shell = useConnectionFormShell(initial);
  const { vaultId, pickVault, userEditedRef, isPinned, togglePin } = shell;

  useEffect(() => {
    serialListPorts()
      .then(setAvailablePorts)
      .catch(() => {});
  }, []);

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
        pre_command: hostCommands.preCommand.trim() || undefined,
        post_command: hostCommands.postCommand.trim() || undefined,
        pre_snippet_id: hostCommands.preSnippetId,
        post_snippet_id: hostCommands.postSnippetId,
        ask_vars_each_time: hostCommands.askVarsEachTime,
        terminal_encoding: hostCommands.terminalEncoding || undefined,
        // Serial has no notes UI; pass through any existing note so saving
        // (e.g. after a note synced in from another device) never wipes it.
        notes: initial?.notes,
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
  useEffect(() => schedule(), [name, serialPort, baud, customBaud, useCustomBaud, dataBits, parity, stopBits, flowControl, hostCommands.preCommand, hostCommands.postCommand, hostCommands.preSnippetId, hostCommands.postSnippetId, hostCommands.askVarsEachTime, hostCommands.terminalEncoding, tags, folderId, vaultId]);

  useImperativeHandle(ref, () => ({ flush, isDirty: () => userEditedRef.current }), [flush]);

  const handleClose = () => flushAndClose(onClose);

  const panelItems = initial
    ? [
        ...(onConnect ? [{ label: t("common.action.connect"), icon: "lucide:terminal", onClick: () => onConnect() }] : []),
        ...(onDuplicate ? [{ label: t("connections.serialForm.duplicate"), icon: "lucide:copy", onClick: () => onDuplicate(), divider: true as const }] : []),
        ...(canEdit && onDelete ? [{ label: t("common.action.delete"), icon: "lucide:trash-2", onClick: () => onDelete(), danger: true as const, divider: true as const }] : []),
      ]
    : [];

  return (
    <PanelShell>
      <PanelHeader
        icon={initial ? "lucide:pencil" : "lucide:ethernet-port"}
        title={initial ? t("connections.serialForm.titleEdit") : t("connections.serialForm.titleNew")}
        subtitle={<VaultPicker vaultId={vaultId} onChange={(id) => pickVault(id, markDirty)} />}
        onClose={handleClose}
        saveState={initial ? saveState : undefined}
        actions={initial ? (
          <>
            <PinButton pinned={isPinned} onToggle={togglePin} />
            {panelItems.length > 0 && <PanelActionsMenu items={panelItems} />}
          </>
        ) : undefined}
      />

      <div className="flex flex-col flex-1 overflow-y-auto">
        <div className="flex-1 px-4 py-4 space-y-3">

          <FormSection label={t("connections.common.general")}>
            <div>
              <label className={formLabelClass} style={formLabelStyle}>{t("connections.common.labelField")}</label>
              <input
                className={formInputClass}
                style={formInputStyle}
                value={name}
                onChange={(e) => { markDirty(); setName(e.target.value); }}
                placeholder={t("connections.serialForm.namePlaceholder")}
              />
            </div>
            <TagsAndFolderFields
              shell={shell}
              tags={tags}
              onChangeTags={setTags}
              folderId={folderId}
              onChangeFolderId={setFolderId}
              markDirty={markDirty}
            />
          </FormSection>

          <FormSection label={t("connections.serialForm.sectionSerialPort")}>
            <div>
              <label className={formLabelClass} style={formLabelStyle}>
                {t("connections.common.port")} <span className="text-(--t-accent)">*</span>
              </label>
              <PortInput
                value={serialPort}
                ports={availablePorts}
                onChange={(v) => { markDirty(); setSerialPort(v); }}
              />
            </div>

            <div>
              <label className={formLabelClass} style={formLabelStyle}>{t("connections.common.baudRate")}</label>
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
                    {t("connections.serialForm.customBaudButton")}
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
                    {t("connections.serialForm.presetBaudButton")}
                  </button>
                </div>
              )}
            </div>

            <AdvancedDisclosure
              open={showAdvanced}
              onToggle={() => setShowAdvanced((v) => !v)}
              hasValues={!!(hostCommandFieldsSet(hostCommands) || dataBits !== 8 || parity !== "none" || stopBits !== 1 || flowControl !== "none")}
            >
              <div>
                <label className={formLabelClass} style={formLabelStyle}>{t("connections.common.dataBits")}</label>
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
                <label className={formLabelClass} style={formLabelStyle}>{t("connections.common.stopBits")}</label>
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
                <label className={formLabelClass} style={formLabelStyle}>{t("connections.common.parity")}</label>
                <Pills
                  options={[
                    { value: "none", label: t("common.state.none") },
                    { value: "even", label: t("connections.common.even") },
                    { value: "odd", label: t("connections.common.odd") },
                  ]}
                  value={parity}
                  onChange={(v) => { markDirty(); setParity(v); }}
                />
              </div>

              <div>
                <label className={formLabelClass} style={formLabelStyle}>{t("connections.common.flowControl")}</label>
                <Pills
                  options={[
                    { value: "none", label: t("common.state.none") },
                    { value: "xon-xoff", label: t("connections.common.xonXoff") },
                    { value: "rts-cts", label: t("connections.common.rtsCts") },
                  ]}
                  value={flowControl}
                  onChange={(v) => { markDirty(); setFlowControl(v); }}
                />
              </div>

              <HostCommandFields connectionId={initial?.id} fields={hostCommands} markDirty={markDirty} />
            </AdvancedDisclosure>
          </FormSection>
        </div>
      </div>
    </PanelShell>
  );
});

export default SerialConnectionForm;
export type { ConnectionFormHandle as SerialConnectionFormHandle };
