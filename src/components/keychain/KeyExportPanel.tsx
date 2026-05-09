import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useRipple } from "@/hooks/useRipple";
import { useConnectionStore } from "@/stores/connectionStore";
import { getSecret } from "@/services/vault";
import { resolveConnectionCredentials } from "@/services/credentials";
import { sshExecCommand } from "@/services/ssh";
import {
  PanelShell, PanelHeader, FormSection,
  formInputClass, formInputStyle, formLabelClass, formLabelStyle,
} from "@/components/shared/Panel";
import { BaseCard } from "@/components/shared/BaseCard";
import { HostPickerPanel } from "@/components/shared/HostPickerPanel";
import { getConnectionIcon, getConnectionIconColor } from "@/utils/icons";
import { KeyCardContent } from "./KeyCards";
import type { SortMode } from "@/components/shared/ToolbarViewControls";
import type { SshKey } from "@/types";

// ─────────────────────────────────────────────────────────────────
// sortByMode helper (used by KeychainPage for keys/identities)
// ─────────────────────────────────────────────────────────────────

export function sortByMode<T extends { name?: string; created_at: string }>(items: T[], mode: SortMode): T[] {
  return [...items].sort((a, b) => {
    switch (mode) {
      case "name-asc":  return (a.name ?? "").localeCompare(b.name ?? "");
      case "name-desc": return (b.name ?? "").localeCompare(a.name ?? "");
      case "newest":    return b.created_at.localeCompare(a.created_at);
      case "oldest":    return a.created_at.localeCompare(b.created_at);
      default:          return 0;
    }
  });
}

// ─────────────────────────────────────────────────────────────────
// KeyExportPanel (side panel)
// ─────────────────────────────────────────────────────────────────

const DEFAULT_EXPORT_SCRIPT = `if test ! -e $1;
then mkdir -p $1;
chmod 700 $1;
fi;
if test ! -e "$1/$2";
then touch "$1/$2";
chmod 600 "$1/$2";
fi;
printf "%s\n%s\n" "$3" "$4" >> "$1/$2";`;

export function KeyExportPanel({ sshKey, onClose }: { sshKey: SshKey; onClose: () => void }) {
  const { connections, loadConnections } = useConnectionStore();
  const [selectedHostId, setSelectedHostId] = useState("");
  const [location, setLocation] = useState(".ssh");
  const [filename, setFilename] = useState("authorized_keys");
  const [script, setScript] = useState(DEFAULT_EXPORT_SCRIPT);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [showHostSelect, setShowHostSelect] = useState(false);
  const [exportStatus, setExportStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [exportError, setExportError] = useState("");
  const { createRipple: rippleExport, rippleEls: ripplesExport } = useRipple();

  useEffect(() => { void loadConnections(); }, [loadConnections]);

  const selectedHost = connections.find((c) => c.id === selectedHostId);

  const handleExport = async () => {
    if (!selectedHost) return;
    setExportStatus("loading");
    setExportError("");
    try {
      const pubKey = await getSecret(`key:${sshKey.id}:public`);
      if (!pubKey) throw new Error("Public key not found");

      const { username, password, privateKey } = await resolveConnectionCredentials(selectedHost);

      const label = sshKey.name ?? "SSH";
      const comment = `# ${label} Key by Voltius`;
      const command = `sh -c '${script}' sh '${location}' '${filename}' '${comment}' '${pubKey.trim()}'`;
      await sshExecCommand({
        host: selectedHost.host,
        port: selectedHost.port,
        username,
        password,
        privateKey,
        command,
      });
      setExportStatus("success");
    } catch (e) {
      setExportError(String(e));
      setExportStatus("error");
    }
  };

  return (
    <div className="relative h-full overflow-hidden">
      <PanelShell>
        <PanelHeader icon="lucide:square-arrow-right" title="Add to host" onClose={onClose} />
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">

          <BaseCard isList={false} className="cursor-default">
            <KeyCardContent sshKey={sshKey} avatarSize={48} iconSize={24} />
          </BaseCard>

          <FormSection label="Export">
            <div className="space-y-3 p-1">
              <div>
                <label className={formLabelClass} style={formLabelStyle}>Destination host</label>
                <button
                  onClick={() => setShowHostSelect(true)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm outline-none transition-colors bg-[var(--t-bg-base)] border border-[var(--t-border)]"
                  style={{ color: selectedHost ? "var(--t-text-primary)" : "var(--t-text-muted)" }}
                  onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--t-border-hover)")}
                  onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {selectedHost && (() => {
                      const displayIcon = selectedHost.icon || selectedHost.distro;
                      return (
                      <div
                        className="rounded-md flex items-center justify-center shrink-0 text-white"
                        style={{ width: "1.333rem", height: "1.333rem", background: displayIcon ? getConnectionIconColor(displayIcon) : "var(--t-bg-card-avatar)" }}
                      >
                        <Icon icon={displayIcon ? getConnectionIcon(displayIcon) : "lucide:server"} width={11} />
                      </div>
                      );
                    })()}
                    <span className="truncate">{selectedHost ? (selectedHost.name ?? `${selectedHost.username}@${selectedHost.host}`) : "Select a host…"}</span>
                  </div>
                  <Icon icon="lucide:chevron-right" width={14} className="text-[var(--t-text-muted)] shrink-0" />
                </button>
              </div>
              <div>
                <label className={formLabelClass} style={formLabelStyle}>Location</label>
                <input value={location} onChange={(e) => setLocation(e.target.value)} className={`${formInputClass} font-mono`} style={formInputStyle} onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")} onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")} />
              </div>
              <div>
                <label className={formLabelClass} style={formLabelStyle}>Filename</label>
                <input value={filename} onChange={(e) => setFilename(e.target.value)} className={`${formInputClass} font-mono`} style={formInputStyle} onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")} onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")} />
              </div>
              <div className="flex gap-2 p-3 rounded-lg bg-[var(--t-bg-card-hover)]">
                <Icon icon="lucide:info" width={14} className="text-[var(--t-text-notice)] shrink-0" style={{ marginTop: 1 }} />
                <p className="text-xs leading-relaxed text-[var(--t-text-notice)]">
                  Key export currently supports only UNIX systems. Use Advanced section to customize the export script.
                </p>
              </div>
            </div>
          </FormSection>

          <FormSection label="Advanced">
            <div className="p-1">
              <button onClick={() => setAdvancedOpen((o) => !o)} className="flex items-center gap-2 w-full mb-2">
                <span className="flex-1 text-left text-xs text-[var(--t-text-muted)]">Export script</span>
                <Icon icon="lucide:chevron-down" width={14} className="text-[var(--t-text-muted)]" style={{ transform: advancedOpen ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 150ms" }} />
              </button>
              {advancedOpen && (
                <textarea
                  value={script}
                  onChange={(e) => setScript(e.target.value)}
                  rows={9}
                  className="w-full px-2.5 py-2 rounded-md text-xs outline-none font-mono resize-none bg-[var(--t-bg-base)] border border-[var(--t-border)] text-[var(--t-text-primary)]"
                  style={{ lineHeight: 1.6 }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "var(--t-accent)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--t-border)")}
                />
              )}
            </div>
          </FormSection>

          {exportStatus === "success" && (
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg mx-1" style={{ background: "color-mix(in srgb, var(--t-accent) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--t-accent) 30%, transparent)" }}>
              <Icon icon="lucide:check-circle" width={14} className="text-[var(--t-accent)] shrink-0" />
              <span className="text-xs text-[var(--t-accent)]">Key exported successfully</span>
            </div>
          )}
          {exportStatus === "error" && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg mx-1" style={{ background: "color-mix(in srgb, var(--t-danger, #ef4444) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--t-danger, #ef4444) 30%, transparent)" }}>
              <Icon icon="lucide:x-circle" width={14} className="text-[var(--t-danger,#ef4444)] shrink-0" style={{ marginTop: 1 }} />
              <span className="text-xs break-all text-[var(--t-danger,#ef4444)]">{exportError}</span>
            </div>
          )}

        </div>

        <div className="px-4 py-3 border-t border-t-[var(--t-border)]">
          <button
            onClick={() => { void handleExport(); }}
            onMouseDown={(!selectedHostId || exportStatus === "loading") ? undefined : rippleExport}
            disabled={!selectedHostId || exportStatus === "loading"}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-opacity bg-[var(--t-accent)] text-white relative overflow-hidden"
            style={{
              opacity: !selectedHostId || exportStatus === "loading" ? 0.5 : 1,
              cursor: !selectedHostId || exportStatus === "loading" ? "not-allowed" : "pointer",
            }}
          >
            {ripplesExport}
            {exportStatus === "loading"
              ? <><Icon icon="lucide:loader" width={14} className="animate-spin" />Exporting…</>
              : <><Icon icon="lucide:square-arrow-right" width={14} />Add to host</>
            }
          </button>
        </div>
      </PanelShell>

      {/* Select Host slide-over */}
      <div
        className="absolute inset-0 transition-transform duration-200 ease-out border-l border-l-[var(--t-bg-terminal)] border-t border-t-[var(--t-bg-card-hover)]"
        style={{ transform: showHostSelect ? "translateX(0)" : "translateX(100%)" }}
      >
        <HostPickerPanel
          selectedHostId={selectedHostId}
          onPick={(h) => { if (h.kind === "remote") setSelectedHostId(h.connection.id); setShowHostSelect(false); }}
          onBack={() => setShowHostSelect(false)}
        />
      </div>
    </div>
  );
}
