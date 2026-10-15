import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useHostPicker } from "@/hooks/useHostPicker";
import { HostPickerTree } from "@/components/shared/HostPickerTree";
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
  const { rows, recent, vaults, vaultFilter, setVaultFilter, toggleFolder } = useHostPicker({ query: q, sshOnly: true, excludeId });

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
        <HostPickerTree
          rows={rows}
          recent={recent}
          onToggleFolder={toggleFolder}
          renderHost={(c) => <PickRow c={c} pingEnabled={pingEnabled} onPick={onPick} />}
          density="touch"
        />
      </div>
    </BottomSheet>
  );
}
