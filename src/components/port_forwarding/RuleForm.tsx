import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

interface Props {
  rule?: PortForwardingRule | null;
  onSave: (data: PortForwardingRuleFormData) => void | Promise<void>;
  onClose: () => void;
  isDirtyRef?: React.MutableRefObject<boolean>;
}

const TUNNEL_TYPES: {
  value: TunnelType;
  label: string;
  title: string;
  summary: string;
  example: string;
  diagram: [string, string, string];
}[] = [
  {
    value: "local",
    label: "Local",
    title: "Local tunnel",
    summary: "Open something from the SSH server on your own machine.",
    example: "Use localhost:3000 on your computer to reach 127.0.0.1:3000 on the server.",
    diagram: ["Your computer", "SSH server", "Remote service"],
  },
  {
    value: "remote",
    label: "Remote",
    title: "Remote tunnel",
    summary: "Expose something from your machine on the SSH server.",
    example: "The server listens on a port and forwards traffic back to your computer.",
    diagram: ["Remote users", "SSH server", "Your computer"],
  },
  {
    value: "dynamic",
    label: "Dynamic",
    title: "Dynamic SOCKS proxy",
    summary: "Create a local SOCKS5 proxy that sends app traffic through the SSH server.",
    example: "Point a browser or app at localhost:1080 to route traffic through the server.",
    diagram: ["Your app", "SOCKS proxy", "SSH server"],
  },
];

function TunnelTypeExplainer({ type }: { type: TunnelType }) {
  const details = TUNNEL_TYPES.find((t) => t.value === type) ?? TUNNEL_TYPES[0];

  return (
    <div className="rounded-lg border border-[var(--t-border)] bg-[var(--t-bg-base)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--t-text-primary)]">{details.title}</h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--t-text-secondary)]">{details.summary}</p>
        </div>
        <span className="shrink-0 rounded-full border border-[var(--t-border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--t-text-dim)]">
          {details.label}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-[1fr_auto_1fr_auto_1fr] items-center gap-1.5 text-center">
        {details.diagram.map((label, index) => (
          <div key={label} className="contents">
            <div className="rounded-md border border-[var(--t-bg-card-hover)] bg-[var(--t-bg-card)] px-2 py-2 text-[10px] font-medium text-[var(--t-text-primary)]">
              {label}
            </div>
            {index < details.diagram.length - 1 && (
              <span className="text-xs text-[var(--t-accent)]">&rarr;</span>
            )}
          </div>
        ))}
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-[var(--t-text-dim)]">{details.example}</p>
    </div>
  );
}

function FieldHelp({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-[10px] leading-relaxed text-[var(--t-text-dim)]">{children}</p>;
}

export function RuleForm({ rule, onSave, onClose, isDirtyRef }: Props) {
  const userEditedRef = useRef(false);
  const defaultVaultId = useDefaultVaultId();
  const vaultPickerTouched = useRef(false);
  const { connections: personalConnections, teamConnections } = useConnectionStore();

  const [name, setName] = useState(rule?.name ?? "");
  const [tunnelType, setTunnelType] = useState<TunnelType>(rule?.tunnel_type ?? "local");
  const [localPort, setLocalPort] = useState(String(rule?.local_port ?? ""));
  const [remotePort, setRemotePort] = useState(String(rule?.remote_port ?? ""));
  const [remoteHost, setRemoteHost] = useState(rule?.remote_host ?? "127.0.0.1");
  const [bindHost, setBindHost] = useState(rule?.bind_host ?? "127.0.0.1");
  const [targetHost, setTargetHost] = useState(rule?.target_host ?? "127.0.0.1");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [vaultId, setVaultId] = useState(rule?.vault_id ?? defaultVaultId ?? "personal");
  const [isGlobal, setIsGlobal] = useState((rule?.connection_ids ?? []).length === 0);
  const [connectionIds, setConnectionIds] = useState<string[]>(rule?.connection_ids ?? []);
  const [showBindWarning, setShowBindWarning] = useState(false);
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
      bind_host: tunnelType === "remote" ? (bindHost.trim() || "127.0.0.1") : "127.0.0.1",
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
  });

  function markDirty() {
    userEditedRef.current = true;
    if (isDirtyRef) isDirtyRef.current = true;
    markAutosaveDirty();
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => schedule(), [name, tunnelType, localPort, remotePort, remoteHost, bindHost, targetHost, description, vaultId, isGlobal, connectionIds]);

  const handleClose = () => flushAndClose(onClose);

  function handleBindHostChange(v: string) {
    markDirty();
    setBindHost(v);
    setShowBindWarning(v === "0.0.0.0");
  }

  function toggleConnection(id: string) {
    markDirty();
    setConnectionIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  return (
    <PanelShell>
      <PanelHeader
        title={rule ? "Edit Rule" : "New Rule"}
        icon="lucide:network"
        subtitle={<VaultPicker vaultId={vaultId} onChange={(v) => { vaultPickerTouched.current = true; markDirty(); setVaultId(v); }} />}
        onClose={handleClose}
        saveState={saveState}
      />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <FormSection label="General">
          <div>
            <label className={formLabelClass} style={formLabelStyle}>Name</label>
            <input
              className={formInputClass}
              style={formInputStyle}
              placeholder="My tunnel"
              value={name}
              onChange={(e) => { markDirty(); setName(e.target.value); }}
              required
            />
          </div>
          <div>
            <label className={formLabelClass} style={formLabelStyle}>Description</label>
            <input
              className={formInputClass}
              style={formInputStyle}
              placeholder="Dev server, database proxy…"
              value={description}
              onChange={(e) => { markDirty(); setDescription(e.target.value); }}
            />
          </div>
        </FormSection>

        <FormSection label="Type">
          <Pills
            options={TUNNEL_TYPES}
            value={tunnelType}
            onChange={(value) => { markDirty(); setTunnelType(value); }}
          />
          <TunnelTypeExplainer type={tunnelType} />
        </FormSection>

        {tunnelType === "local" && (
          <FormSection label="Ports">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={formLabelClass} style={formLabelStyle}>Port on your computer</label>
                <input type="number" min={1} max={65535} className={formInputClass} style={formInputStyle}
                  placeholder="3000" value={localPort}
                  onChange={(e) => { markDirty(); setLocalPort(e.target.value); }} required />
                <FieldHelp>You connect to this port locally, usually as localhost:{localPort || "3000"}.</FieldHelp>
              </div>
              <div>
                <label className={formLabelClass} style={formLabelStyle}>Port on SSH server</label>
                <input type="number" min={1} max={65535} className={formInputClass} style={formInputStyle}
                  placeholder="3000" value={remotePort}
                  onChange={(e) => { markDirty(); setRemotePort(e.target.value); }} required />
                <FieldHelp>The port where the service is running from the server's point of view.</FieldHelp>
              </div>
            </div>
            <div className="mt-3">
              <label className={formLabelClass} style={formLabelStyle}>Host on SSH server</label>
              <input className={formInputClass} style={formInputStyle} placeholder="127.0.0.1"
                value={remoteHost} onChange={(e) => { markDirty(); setRemoteHost(e.target.value); }} />
              <FieldHelp>Use 127.0.0.1 when the service runs on the SSH server itself.</FieldHelp>
            </div>
          </FormSection>
        )}

        {tunnelType === "remote" && (
          <FormSection label="Ports">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={formLabelClass} style={formLabelStyle}>Port opened on SSH server</label>
                <input type="number" min={1} max={65535} className={formInputClass} style={formInputStyle}
                  placeholder="3000" value={remotePort}
                  onChange={(e) => { markDirty(); setRemotePort(e.target.value); }} required />
                <FieldHelp>People or services on the server side connect to this port.</FieldHelp>
              </div>
              <div>
                <label className={formLabelClass} style={formLabelStyle}>Port on your computer</label>
                <input type="number" min={1} max={65535} className={formInputClass} style={formInputStyle}
                  placeholder="3000" value={localPort}
                  onChange={(e) => { markDirty(); setLocalPort(e.target.value); }} required />
                <FieldHelp>The local app or service that should receive the forwarded traffic.</FieldHelp>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label className={formLabelClass} style={formLabelStyle}>Bind address on SSH server</label>
                <input className={formInputClass} style={formInputStyle} placeholder="127.0.0.1"
                  value={bindHost} onChange={(e) => handleBindHostChange(e.target.value)} />
                <FieldHelp>127.0.0.1 keeps it private to the server. 0.0.0.0 may expose it to the network.</FieldHelp>
                {showBindWarning && (
                  <p className="text-[10px] text-amber-400 mt-1">
                    0.0.0.0 exposes this port through the remote server to all its network interfaces.
                  </p>
                )}
              </div>
              <div>
                <label className={formLabelClass} style={formLabelStyle}>Host on your computer</label>
                <input className={formInputClass} style={formInputStyle} placeholder="127.0.0.1"
                  value={targetHost} onChange={(e) => { markDirty(); setTargetHost(e.target.value); }} />
                <FieldHelp>Use 127.0.0.1 when the target app runs on this computer.</FieldHelp>
              </div>
            </div>
          </FormSection>
        )}

        {tunnelType === "dynamic" && (
          <FormSection label="Ports">
            <label className={formLabelClass} style={formLabelStyle}>SOCKS proxy port on your computer</label>
            <input type="number" min={1} max={65535} className={formInputClass} style={formInputStyle}
              placeholder="1080" value={localPort}
              onChange={(e) => { markDirty(); setLocalPort(e.target.value); }} required />
            <FieldHelp>Configure apps to use localhost:{localPort || "1080"} as a SOCKS5 proxy.</FieldHelp>
          </FormSection>
        )}

        <FormSection label="Scope">
          <label className={formLabelClass} style={formLabelStyle}>Apply to</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => { markDirty(); setIsGlobal(true); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                isGlobal ? "bg-[var(--t-accent)] text-white"
                : "bg-[var(--t-bg-elevated)] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"
              }`}>
              All connections
            </button>
            <button type="button" onClick={() => { markDirty(); setIsGlobal(false); }}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                !isGlobal ? "bg-[var(--t-accent)] text-white"
                : "bg-[var(--t-bg-elevated)] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"
              }`}>
              Specific connections
            </button>
          </div>
          {!isGlobal && (
            <div className="mt-2 flex flex-col gap-0.5 max-h-40 overflow-y-auto">
              {connections.length === 0 ? (
                <p className="text-xs text-[var(--t-text-dim)] py-1">No saved connections.</p>
              ) : connections.map((conn) => {
                const checked = connectionIds.includes(conn.id);
                const label = conn.name?.trim() || `${conn.username}@${conn.host}:${conn.port}`;
                return (
                  <label key={conn.id}
                    className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-[var(--t-bg-elevated)]">
                    <input type="checkbox" checked={checked} onChange={() => toggleConnection(conn.id)}
                      className="accent-[var(--t-accent)]" />
                    <span className="text-xs text-[var(--t-text-primary)] truncate">{label}</span>
                  </label>
                );
              })}
            </div>
          )}
        </FormSection>

      </div>
    </PanelShell>
  );
}
