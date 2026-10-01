import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { useHostPicker } from "@/hooks/useHostPicker";
import { hostPickerRowKey } from "@/utils/hostPickerTree";
import { chevronRotateStyle } from "@/utils/icons";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { StatusDot } from "@/components/shared/StatusDot";
import { pingStatusMotion, pingStatusTone } from "@/utils/statusTone";
import { useHostPingStore } from "@/stores/hostPingStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import type { Connection } from "@/types";
import BottomSheet from "./BottomSheet";

function PickRow({ c, pingEnabled, onPick }: { c: Connection; pingEnabled: boolean; onPick: (id: string) => void }) {
  const pingStatus = useHostPingStore((s) => s.statuses[c.id]);
  const pingLatency = useHostPingStore((s) => s.latencies[c.id]);
  const showPingDot = pingEnabled && !c.ping_disabled;
  const latency = showPingDot && pingStatus === "up" && pingLatency !== undefined ? ` · ${pingLatency}ms` : "";

  return (
    <button data-sftp-host-pick={c.id} onClick={() => onPick(c.id)}
      className="w-full flex items-center gap-3 px-3 py-3 text-left rounded-xl active:bg-(--t-bg-card)">
      <span className="relative shrink-0">
        <ConnectionAvatar connection={c} size={30} />
        {showPingDot && (
          <StatusDot
            tone={pingStatusTone(pingStatus)}
            motion={pingStatusMotion(pingStatus)}
            halo="var(--t-bg-elevated)"
            corner
          />
        )}
      </span>
      <span className="flex flex-col min-w-0">
        <span className="text-sm font-medium text-(--t-text-primary) truncate">{connectionDisplayName(c)}</span>
        <span className="text-xs text-(--t-text-dim) truncate">{c.username}@{c.host}{c.port !== 22 ? `:${c.port}` : ""}{latency}</span>
      </span>
    </button>
  );
}

export default function SftpHostPickerSheet({
  excludeId, onPick, onClose,
}: { excludeId?: string; onPick: (id: string) => void; onClose: () => void }) {
  const { t } = useTranslation();
  const [pingEnabled] = useToggle("reachability");
  const [q, setQ] = useState("");
  const { rows, vaults, vaultFilter, setVaultFilter, toggleFolder } = useHostPicker({ query: q, sshOnly: true, excludeId });

  return (
    <BottomSheet title={t("mobile.sftp.chooseHost")} onClose={onClose}>
      <input data-sftp-host-search autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("mobile.hostsScreen.searchPlaceholder")}
        className="w-full rounded-xl px-3 h-10 text-sm outline-none text-(--t-text-primary) mb-2"
        style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }} />
      {vaults.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
          {[{ id: null, name: t("shared.hostPicker.allVaults") }, ...vaults].map((v) => (
            <button key={v.id ?? ""} data-sftp-host-vault={v.id ?? "all"} onClick={() => setVaultFilter(v.id)}
              className="shrink-0 px-3 h-8 rounded-full text-xs font-medium whitespace-nowrap"
              style={v.id === vaultFilter
                ? { background: "var(--t-accent)", color: "var(--t-bg-terminal)" }
                : { background: "var(--t-bg-card)", color: "var(--t-text-secondary)", border: "1px solid var(--t-border)" }}>
              {v.name}
            </button>
          ))}
        </div>
      )}
      <div className="max-h-[50vh] overflow-y-auto">
        {rows.length === 0 && <div className="px-3 py-6 text-center text-sm text-(--t-text-dim)">{t("mobile.sheets.sftpHostPicker.noSshHosts")}</div>}
        {rows.map((row) => {
          if (row.kind === "vault") {
            return <div key={hostPickerRowKey(row)} className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider truncate text-(--t-text-dim)">{row.name}</div>;
          }
          const indent = { paddingLeft: `${row.depth}rem` };
          if (row.kind === "folder") {
            return (
              <div key={hostPickerRowKey(row)} style={indent}>
                <button data-sftp-host-folder={row.folder.id} aria-expanded={!row.collapsed} onClick={() => toggleFolder(row.folder.id)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left rounded-xl active:bg-(--t-bg-card)">
                  <Icon icon="lucide:chevron-right" width={16} className="shrink-0 text-(--t-text-dim)" style={chevronRotateStyle(!row.collapsed, 90)} />
                  <Icon icon="lucide:folder" width={16} className="shrink-0 text-(--t-text-dim)" />
                  <span className="flex-1 min-w-0 text-sm font-medium text-(--t-text-primary) truncate">{row.folder.name}</span>
                  <span className="text-xs text-(--t-text-dim) shrink-0">{row.count}</span>
                </button>
              </div>
            );
          }
          return <div key={hostPickerRowKey(row)} style={indent}><PickRow c={row.connection} pingEnabled={pingEnabled} onPick={onPick} /></div>;
        })}
      </div>
    </BottomSheet>
  );
}
