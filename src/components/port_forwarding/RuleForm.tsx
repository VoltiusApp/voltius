import { useEffect, useState } from "react";
import {
  PanelShell, PanelHeader, FormSection,
  formInputClass, formInputStyle, formLabelClass, formLabelStyle,
} from "@/components/shared/Panel";
import { VaultPicker } from "@/components/shared/VaultPicker";
import { useDefaultVaultId } from "@/hooks/useWritableVaultIds";
import { useConnectionStore } from "@/stores/connectionStore";
import type { PortForwardingRule, PortForwardingRuleFormData } from "@/types";

interface Props {
  rule?: PortForwardingRule | null;
  onSave: (data: PortForwardingRuleFormData) => void;
  onClose: () => void;
}

export function RuleForm({ rule, onSave, onClose }: Props) {
  const defaultVaultId = useDefaultVaultId();
  const connections = useConnectionStore((s) => s.connections.filter((c) => !c.deleted_at));

  const [name, setName] = useState(rule?.name ?? "");
  const [localPort, setLocalPort] = useState(String(rule?.local_port ?? ""));
  const [remotePort, setRemotePort] = useState(String(rule?.remote_port ?? ""));
  const [remoteHost, setRemoteHost] = useState(rule?.remote_host ?? "127.0.0.1");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [vaultId, setVaultId] = useState(rule?.vault_id ?? defaultVaultId ?? "personal");
  const [isGlobal, setIsGlobal] = useState((rule?.connection_ids ?? []).length === 0);
  const [connectionIds, setConnectionIds] = useState<string[]>(rule?.connection_ids ?? []);

  useEffect(() => {
    if (rule) {
      setName(rule.name);
      setLocalPort(String(rule.local_port));
      setRemotePort(String(rule.remote_port));
      setRemoteHost(rule.remote_host);
      setDescription(rule.description ?? "");
      setVaultId(rule.vault_id);
      const cids = rule.connection_ids ?? [];
      setIsGlobal(cids.length === 0);
      setConnectionIds(cids);
    }
  }, [rule?.id]);

  function toggleConnection(id: string) {
    setConnectionIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const lp = parseInt(localPort, 10);
    const rp = parseInt(remotePort, 10);
    if (!name.trim() || isNaN(lp) || isNaN(rp)) return;
    onSave({
      name: name.trim(),
      local_port: lp,
      remote_port: rp,
      remote_host: remoteHost.trim() || "127.0.0.1",
      description: description.trim() || undefined,
      connection_ids: isGlobal ? [] : connectionIds,
      folder_id: rule?.folder_id,
      vault_id: vaultId,
    });
  }

  return (
    <PanelShell>
      <PanelHeader
        title={rule ? "Edit Rule" : "New Rule"}
        icon="lucide:network"
        onClose={onClose}
      />
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 p-4 flex-1 overflow-y-auto">
        <FormSection label="Basic">
          <label className={formLabelClass} style={formLabelStyle}>
            Name
          </label>
          <input
            className={formInputClass}
            style={formInputStyle}
            placeholder="My tunnel"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </FormSection>

        <FormSection label="Ports">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={formLabelClass} style={formLabelStyle}>Local port</label>
              <input
                type="number"
                min={1}
                max={65535}
                className={formInputClass}
                style={formInputStyle}
                placeholder="3000"
                value={localPort}
                onChange={(e) => setLocalPort(e.target.value)}
                required
              />
            </div>
            <div>
              <label className={formLabelClass} style={formLabelStyle}>Remote port</label>
              <input
                type="number"
                min={1}
                max={65535}
                className={formInputClass}
                style={formInputStyle}
                placeholder="3000"
                value={remotePort}
                onChange={(e) => setRemotePort(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="mt-3">
            <label className={formLabelClass} style={formLabelStyle}>Remote host</label>
            <input
              className={formInputClass}
              style={formInputStyle}
              placeholder="127.0.0.1"
              value={remoteHost}
              onChange={(e) => setRemoteHost(e.target.value)}
            />
          </div>
        </FormSection>

        <FormSection label="Optional">
          <label className={formLabelClass} style={formLabelStyle}>Description</label>
          <input
            className={formInputClass}
            style={formInputStyle}
            placeholder="Dev server, database proxy…"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </FormSection>

        <FormSection label="Scope">
          <label className={formLabelClass} style={formLabelStyle}>Apply to</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setIsGlobal(true)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                isGlobal
                  ? "bg-[var(--t-accent)] text-white"
                  : "bg-[var(--t-bg-elevated)] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"
              }`}
            >
              All connections
            </button>
            <button
              type="button"
              onClick={() => setIsGlobal(false)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                !isGlobal
                  ? "bg-[var(--t-accent)] text-white"
                  : "bg-[var(--t-bg-elevated)] text-[var(--t-text-muted)] hover:text-[var(--t-text-primary)]"
              }`}
            >
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
                  <label
                    key={conn.id}
                    className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-[var(--t-bg-elevated)]"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleConnection(conn.id)}
                      className="accent-[var(--t-accent)]"
                    />
                    <span className="text-xs text-[var(--t-text-primary)] truncate">{label}</span>
                  </label>
                );
              })}
            </div>
          )}
        </FormSection>

        <FormSection label="Vault">
          <VaultPicker vaultId={vaultId} onChange={setVaultId} />
        </FormSection>

        <div className="flex gap-2 pt-2">
          <button
            type="submit"
            className="flex-1 py-1.5 rounded-lg text-sm font-medium bg-[var(--t-accent)] text-white hover:opacity-90 transition-opacity"
          >
            {rule ? "Save changes" : "Create rule"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-sm font-medium bg-[var(--t-bg-elevated)] text-[var(--t-text-primary)] hover:bg-[var(--t-bg-card)] transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </PanelShell>
  );
}
