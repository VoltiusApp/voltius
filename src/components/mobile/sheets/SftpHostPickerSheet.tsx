import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAllConnections } from "@/hooks/useAllConnections";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import { StatusDot } from "@/components/shared/StatusDot";
import { useHostPingStore } from "@/stores/hostPingStore";
import { useToggle } from "@/stores/toggleSettingsStore";
import type { Connection } from "@/types";
import BottomSheet from "./BottomSheet";

function PickRow({ c, pingEnabled, onPick }: { c: Connection; pingEnabled: boolean; onPick: (id: string) => void }) {
  const pingStatus = useHostPingStore((s) => s.statuses[c.id]);
  const pingLatency = useHostPingStore((s) => s.latencies[c.id]);
  const showPingDot = pingEnabled && !c.ping_disabled;
  const pingColor = pingStatus === "up" ? "var(--t-status-connected)"
    : pingStatus === "down" ? "var(--t-status-error)" : "var(--t-text-dim)";
  const latency = showPingDot && pingStatus === "up" && pingLatency !== undefined ? ` · ${pingLatency}ms` : "";

  return (
    <button data-sftp-host-pick={c.id} onClick={() => onPick(c.id)}
      className="w-full flex items-center gap-3 px-3 py-3 text-left rounded-xl active:bg-(--t-bg-card)">
      <span className="relative shrink-0">
        <ConnectionAvatar connection={c} size={30} />
        {showPingDot && <StatusDot color={pingColor} animate={pingStatus === "up"} size={9} />}
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
  const connections = useAllConnections();
  const [pingEnabled] = useToggle("reachability");
  const [q, setQ] = useState("");
  const hosts = useMemo(() => {
    const ssh = connections.filter((c) => c.connection_type !== "serial" && !c.serial_port && c.id !== excludeId);
    const needle = q.trim().toLowerCase();
    return needle ? ssh.filter((c) => connectionDisplayName(c).toLowerCase().includes(needle) || (c.host ?? "").toLowerCase().includes(needle)) : ssh;
  }, [connections, q, excludeId]);

  return (
    <BottomSheet title={t("mobile.sftp.chooseHost")} onClose={onClose}>
      <input data-sftp-host-search autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("mobile.hostsScreen.searchPlaceholder")}
        className="w-full rounded-xl px-3 h-10 text-sm outline-none text-(--t-text-primary) mb-2"
        style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }} />
      <div className="max-h-[50vh] overflow-y-auto">
        {hosts.length === 0 && <div className="px-3 py-6 text-center text-sm text-(--t-text-dim)">{t("mobile.sheets.sftpHostPicker.noSshHosts")}</div>}
        {hosts.map((c) => <PickRow key={c.id} c={c} pingEnabled={pingEnabled} onPick={onPick} />)}
      </div>
    </BottomSheet>
  );
}
