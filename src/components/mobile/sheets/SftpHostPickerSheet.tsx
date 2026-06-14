import { useMemo, useState } from "react";
import { useAllConnections } from "@/hooks/useAllConnections";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { ConnectionAvatar } from "@/components/shared/ConnectionAvatar";
import BottomSheet from "./BottomSheet";

export default function SftpHostPickerSheet({
  excludeId, onPick, onClose,
}: { excludeId?: string; onPick: (id: string) => void; onClose: () => void }) {
  const connections = useAllConnections();
  const [q, setQ] = useState("");
  const hosts = useMemo(() => {
    const ssh = connections.filter((c) => c.connection_type !== "serial" && !c.serial_port && c.id !== excludeId);
    const needle = q.trim().toLowerCase();
    return needle ? ssh.filter((c) => connectionDisplayName(c).toLowerCase().includes(needle) || (c.host ?? "").toLowerCase().includes(needle)) : ssh;
  }, [connections, q, excludeId]);

  return (
    <BottomSheet title="Choose a host" onClose={onClose}>
      <input data-sftp-host-search autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search hosts"
        className="w-full rounded-xl px-3 h-10 text-sm outline-none text-(--t-text-primary) mb-2"
        style={{ background: "var(--t-bg-card)", border: "1px solid var(--t-border)" }} />
      <div className="max-h-[50vh] overflow-y-auto">
        {hosts.length === 0 && <div className="px-3 py-6 text-center text-sm text-(--t-text-dim)">No SSH hosts</div>}
        {hosts.map((c) => (
          <button key={c.id} data-sftp-host-pick={c.id} onClick={() => onPick(c.id)}
            className="w-full flex items-center gap-3 px-3 py-3 text-left rounded-xl active:bg-(--t-bg-card)">
            <ConnectionAvatar connection={c} size={30} />
            <span className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-(--t-text-primary) truncate">{connectionDisplayName(c)}</span>
              <span className="text-xs text-(--t-text-dim) truncate">{c.username}@{c.host}{c.port !== 22 ? `:${c.port}` : ""}</span>
            </span>
          </button>
        ))}
      </div>
    </BottomSheet>
  );
}
