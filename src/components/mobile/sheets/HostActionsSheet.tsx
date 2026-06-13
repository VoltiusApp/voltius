import { Icon } from "@iconify/react";
import BottomSheet from "./BottomSheet";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useConnectionStore, connectionToFormData } from "@/stores/connectionStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useSessionStore } from "@/stores/sessionStore";
import { useUIStore } from "@/stores/uiStore";
import { connectionDisplayName } from "@/utils/connectionDisplayName";

export default function HostActionsSheet({ hostId }: { hostId: string }) {
  const closeSheet = useMobileNavStore((s) => s.closeSheet);
  const push = useMobileNavStore((s) => s.push);
  const connections = useAllConnections();
  const conn = connections.find((c) => c.id === hostId);
  const saveConnection = useConnectionStore((s) => s.saveConnection);
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);
  const hasSftpSession = useSessionStore((s) =>
    s.sessions.some((x) => x.connectionId === hostId && x.status === "connected" && x.type === "ssh"));

  if (!conn) return null;

  const items = [
    { icon: "lucide:pencil", label: "Edit", onTap: () => { closeSheet(); push({ kind: "host-edit", hostId }); } },
    { icon: "lucide:copy", label: "Duplicate", onTap: () => {
        void saveConnection({ ...connectionToFormData(conn), name: `${connectionDisplayName(conn)} copy` });
        closeSheet();
      } },
    ...(hasSftpSession ? [{ icon: "lucide:folder-open", label: "SFTP", onTap: () => {
        useUIStore.getState().openSftpWith(hostId);
        closeSheet();
        push({ kind: "sftp" });
      } }] : []),
    { icon: "lucide:trash-2", label: "Delete", danger: true, onTap: () => { void deleteConnection(hostId); closeSheet(); } },
  ];

  return (
    <BottomSheet title={connectionDisplayName(conn)} onClose={closeSheet}>
      {items.map((it) => (
        <button
          key={it.label}
          data-host-action={it.label.toLowerCase()}
          className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-left active:bg-(--t-bg-card)"
          style={{ color: it.danger ? "var(--t-danger, #e5484d)" : "var(--t-text-primary)" }}
          onClick={it.onTap}
        >
          <Icon icon={it.icon} width={18} />
          <span className="text-sm font-medium">{it.label}</span>
        </button>
      ))}
    </BottomSheet>
  );
}
