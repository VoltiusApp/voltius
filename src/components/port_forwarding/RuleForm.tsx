import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAutosave } from "@/hooks/useAutosave";
import {
  PanelShell, PanelHeader, FormSection,
  formInputClass, formInputStyle, formLabelClass, formLabelStyle,
} from "@/components/shared/Panel";
import { Pills } from "@/components/shared/Pills";
import { VaultPicker } from "@/components/shared/VaultPicker";
import { useDefaultVaultId, resolveVaultIdForSave } from "@/hooks/useWritableVaultIds";
import { useConnectionStore } from "@/stores/connectionStore";
import type { PortForwardingRule, PortForwardingRuleFormData, TunnelType } from "@/types";
import { PermissionsSection } from "@/components/permissions/PermissionsSection";
import { ReadOnlyFields, withEditAccess, type EditAccessProps } from "@/components/shared/editAccess";
import { describeRoute } from "@/utils/tunnelRoute";
import { EndpointFields, HopArrow, HopCard, ListenerFields, RouteSummary } from "./RuleRoute";

interface Props {
  rule?: PortForwardingRule | null;
  initialTunnelType?: TunnelType;
  onSave: (data: PortForwardingRuleFormData) => void | Promise<void>;
  onClose: () => void;
  isDirtyRef?: React.MutableRefObject<boolean>;
}

function buildTunnelTypes(t: (key: string) => string): { value: TunnelType; label: string; summary: string }[] {
  return (["local", "remote", "dynamic"] as const).map((value) => ({
    value,
    label: t(`portForwarding.ruleForm.tunnelTypes.${value}.label`),
    summary: t(`portForwarding.ruleForm.tunnelTypes.${value}.summary`),
  }));
}

export const RuleForm = withEditAccess("port_forwarding_rule", (p: Props) => p.rule ?? undefined, RuleFormEditor);

function RuleFormEditor({ rule, initialTunnelType, onSave, onClose, isDirtyRef, readOnly }: Props & EditAccessProps) {
  const { t } = useTranslation();
  const TUNNEL_TYPES = useMemo(() => buildTunnelTypes(t), [t]);
  const userEditedRef = useRef(false);
  const defaultVaultId = useDefaultVaultId();
  const vaultPickerTouched = useRef(false);
  const { connections: personalConnections, teamConnections } = useConnectionStore();

  const [name, setName] = useState(rule?.name ?? "");
  const [tunnelType, setTunnelType] = useState<TunnelType>(rule?.tunnel_type ?? initialTunnelType ?? "local");
  const [localPort, setLocalPort] = useState(String(rule?.local_port ?? ""));
  const [remotePort, setRemotePort] = useState(String(rule?.remote_port ?? ""));
  const [remoteHost, setRemoteHost] = useState(rule?.remote_host ?? "127.0.0.1");
  const [bindHost, setBindHost] = useState(rule?.bind_host ?? "127.0.0.1");
  const [targetHost, setTargetHost] = useState(rule?.target_host ?? "127.0.0.1");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [vaultId, setVaultId] = useState(rule?.vault_id ?? defaultVaultId ?? "personal");
  const [isGlobal, setIsGlobal] = useState((rule?.connection_ids ?? []).length === 0);
  const [connectionIds, setConnectionIds] = useState<string[]>(rule?.connection_ids ?? []);
  const isNew = !rule;

  useEffect(() => {
    if (isNew && !vaultPickerTouched.current) setVaultId(defaultVaultId);
  }, [isNew, defaultVaultId]);

  const saveVaultId = resolveVaultIdForSave(vaultId);
  const connections = useMemo(() => {
    const source = saveVaultId === "personal" ? personalConnections : (teamConnections[saveVaultId] ?? []);
    return source.filter((c) => !c.deleted_at);
  }, [personalConnections, saveVaultId, teamConnections]);

  useEffect(() => {
    setConnectionIds((prev) => prev.filter((id) => connections.some((c) => c.id === id)));
  }, [connections]);

  useEffect(() => {
    if (rule) {
      setName(rule.name);
      setTunnelType(rule.tunnel_type ?? "local");
      setLocalPort(String(rule.local_port));
      setRemotePort(String(rule.remote_port));
      setRemoteHost(rule.remote_host);
      setBindHost(rule.bind_host ?? "127.0.0.1");
      setTargetHost(rule.target_host ?? "127.0.0.1");
      setDescription(rule.description ?? "");
      setVaultId(rule.vault_id);
      const cids = rule.connection_ids ?? [];
      setIsGlobal(cids.length === 0);
      setConnectionIds(cids);
    }
  }, [rule?.id]);

  const buildSaveData = useCallback((): PortForwardingRuleFormData => {
    const lp = parseInt(localPort, 10);
    const rp = parseInt(remotePort, 10);

    return {
      name: name.trim(),
      local_port: lp,
      remote_port: tunnelType === "dynamic" ? 0 : rp,
      remote_host: tunnelType === "local" ? (remoteHost.trim() || "127.0.0.1") : "127.0.0.1",
      tunnel_type: tunnelType,
      bind_host: bindHost.trim() || "127.0.0.1",
      target_host: tunnelType === "remote" ? (targetHost.trim() || "127.0.0.1") : "127.0.0.1",
      description: description.trim() || undefined,
      connection_ids: isGlobal ? [] : connectionIds,
      folder_id: rule?.folder_id,
      vault_id: saveVaultId,
    };
  }, [bindHost, connectionIds, description, isGlobal, localPort, name, remoteHost, remotePort, rule?.folder_id, saveVaultId, targetHost, tunnelType]);

  const canSave = useCallback(() => {
    const lp = parseInt(localPort, 10);
    const rp = parseInt(remotePort, 10);
    return !!name.trim() && !isNaN(lp) && (tunnelType === "dynamic" || !isNaN(rp));
  }, [localPort, name, remotePort, tunnelType]);

  const { schedule, markDirty: markAutosaveDirty, flushAndClose, saveState } = useAutosave({
    onSave: () => onSave(buildSaveData()) ?? undefined,
    canSave,
    readOnly,
  });

  function markDirty() {
    userEditedRef.current = true;
    if (isDirtyRef) isDirtyRef.current = true;
    markAutosaveDirty();
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [name, tunnelType, localPort, remotePort, remoteHost, bindHost, targetHost, description, vaultId, isGlobal, connectionIds]);

  const handleClose = () => flushAndClose(onClose);

  const edit = (set: (value: string) => void) => (value: string) => { markDirty(); set(value); };

  function changeTunnelType(next: TunnelType) {
    markDirty();
    // The listener moves to the other machine, so its address does not carry over.
    if ((next === "remote") !== (tunnelType === "remote")) setBindHost("127.0.0.1");
    setTunnelType(next);
  }

  function toggleConnection(id: string) {
    markDirty();
    setConnectionIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  const onlyConnection = !isGlobal && connectionIds.length === 1 ? connections.find((c) => c.id === connectionIds[0]) : undefined;
  const sshTarget = onlyConnection
    ? `${onlyConnection.port === 22 ? "" : `-p ${onlyConnection.port} `}${onlyConnection.username}@${onlyConnection.host}`
    : t("portForwarding.ruleForm.summary.anyHost");
  const routeSummary = describeRoute(
    { tunnelType, localPort, remotePort, bindHost, remoteHost, targetHost },
    { anyAddress: t("portForwarding.ruleForm.summary.anyAddress"), sshTarget },
  );

  return (
    <PanelShell>
      <PanelHeader
        title={rule ? t("portForwarding.ruleForm.editRule") : t("portForwarding.ruleForm.newRule")}
        icon="lucide:network"
        subtitle={<VaultPicker vaultId={vaultId} onChange={(v) => { vaultPickerTouched.current = true; markDirty(); setVaultId(v); }} disabled={readOnly} />}
        onClose={handleClose}
        saveState={saveState}
      />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <ReadOnlyFields readOnly={readOnly} className="space-y-4">
        <FormSection label={t("portForwarding.ruleForm.general")}>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>{t("portForwarding.ruleForm.name")}</label>
            <input
              className={formInputClass}
              style={formInputStyle}
              placeholder={t("portForwarding.ruleForm.namePlaceholder")}
              value={name}
              onChange={(e) => { markDirty(); setName(e.target.value); }}
              required
            />
          </div>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>{t("portForwarding.ruleForm.description")}</label>
            <input
              className={formInputClass}
              style={formInputStyle}
              placeholder={t("portForwarding.ruleForm.descriptionPlaceholder")}
              value={description}
              onChange={(e) => { markDirty(); setDescription(e.target.value); }}
            />
          </div>
        </FormSection>

        <FormSection label={t("portForwarding.ruleForm.type")}>
          <Pills options={TUNNEL_TYPES} value={tunnelType} onChange={changeTunnelType} />
          <p className="mt-2 text-xs leading-relaxed text-(--t-text-secondary)">
            {TUNNEL_TYPES.find((type) => type.value === tunnelType)?.summary}
          </p>
        </FormSection>

        <FormSection label={t("portForwarding.ruleForm.route")}>
          {tunnelType !== "remote" && (
            <>
              <HopCard icon="lucide:laptop" title={t("portForwarding.ruleForm.yourComputer")}>
                <ListenerFields
                  key={tunnelType}
                  side="computer"
                  portLabel={t(`portForwarding.ruleForm.${tunnelType === "dynamic" ? "socksPort" : "listenPort"}`)}
                  portPlaceholder={tunnelType === "dynamic" ? "1080" : "3000"}
                  port={localPort}
                  onPort={edit(setLocalPort)}
                  bindHost={bindHost}
                  onBindHost={edit(setBindHost)}
                />
              </HopCard>
              <HopArrow label={t("portForwarding.ruleForm.throughTunnel")} />
            </>
          )}

          <HopCard icon="lucide:server" title={t("portForwarding.ruleForm.sshServer")}>
            {tunnelType === "remote" && (
              <ListenerFields
                side="server"
                portLabel={t("portForwarding.ruleForm.listenPort")}
                portPlaceholder="3000"
                port={remotePort}
                onPort={edit(setRemotePort)}
                bindHost={bindHost}
                onBindHost={edit(setBindHost)}
              />
            )}
            <div>
              <label className={formLabelClass} style={formLabelStyle}>{t("portForwarding.ruleForm.applyTo")}</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => { markDirty(); setIsGlobal(true); }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    isGlobal ? "bg-(--t-accent) text-white"
                    : "bg-(--t-bg-elevated) text-(--t-text-muted) hover:text-(--t-text-primary)"
                  }`}>
                  {t("portForwarding.ruleForm.allConnections")}
                </button>
                <button type="button" onClick={() => { markDirty(); setIsGlobal(false); }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    !isGlobal ? "bg-(--t-accent) text-white"
                    : "bg-(--t-bg-elevated) text-(--t-text-muted) hover:text-(--t-text-primary)"
                  }`}>
                  {t("portForwarding.ruleForm.specificConnections")}
                </button>
              </div>
              {!isGlobal && (
                <div className="mt-2 flex flex-col gap-0.5 max-h-40 overflow-y-auto">
                  {connections.length === 0 ? (
                    <p className="text-xs text-(--t-text-dim) py-1">{t("portForwarding.ruleForm.noSavedConnections")}</p>
                  ) : connections.map((conn) => {
                    const checked = connectionIds.includes(conn.id);
                    const label = conn.name?.trim() || `${conn.username}@${conn.host}:${conn.port}`;
                    return (
                      <label key={conn.id}
                        className="flex items-center gap-2 px-2 py-1 rounded-sm cursor-pointer hover:bg-(--t-bg-elevated)">
                        <input type="checkbox" checked={checked} onChange={() => toggleConnection(conn.id)}
                          className="accent-(--t-accent)" />
                        <span className="text-xs text-(--t-text-primary) truncate">{label}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </HopCard>

          {tunnelType === "local" && (
            <>
              <HopArrow label={t("portForwarding.ruleForm.reaches")} />
              <HopCard icon="lucide:box" title={t("portForwarding.ruleForm.service")}>
                <EndpointFields host={remoteHost} onHost={edit(setRemoteHost)} port={remotePort} onPort={edit(setRemotePort)} />
              </HopCard>
            </>
          )}
          {tunnelType === "remote" && (
            <>
              <HopArrow label={t("portForwarding.ruleForm.backThroughTunnel")} />
              <HopCard icon="lucide:laptop" title={t("portForwarding.ruleForm.yourComputer")}>
                <EndpointFields host={targetHost} onHost={edit(setTargetHost)} port={localPort} onPort={edit(setLocalPort)} />
              </HopCard>
            </>
          )}
          {tunnelType === "dynamic" && (
            <>
              <HopArrow label={t("portForwarding.ruleForm.reaches")} />
              <HopCard icon="lucide:globe" title={t("portForwarding.ruleForm.anyDestination")}>
                <p className="text-xs leading-relaxed text-(--t-text-secondary)">{t("portForwarding.ruleForm.anyDestinationHelp")}</p>
              </HopCard>
            </>
          )}

          <RouteSummary summary={routeSummary} />
        </FormSection>
        </ReadOnlyFields>
        {rule && <PermissionsSection objectId={rule.id} vaultId={rule.vault_id} type="port_forwarding_rule" />}
      </div>
    </PanelShell>
  );
}
