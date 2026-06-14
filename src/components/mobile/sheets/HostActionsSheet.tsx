import { useState } from "react";
import { Icon } from "@iconify/react";
import BottomSheet from "./BottomSheet";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useConnectionStore, connectionToFormData } from "@/stores/connectionStore";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useSessionStore } from "@/stores/sessionStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { connectionDisplayName } from "@/utils/connectionDisplayName";
import { writeClipboard } from "@/utils/clipboard";

type Mode = "menu" | "confirm-delete" | "move";

type Item = { icon: string; label: string; danger?: boolean; onTap: () => void };

export default function HostActionsSheet({ hostId }: { hostId: string }) {
  const closeSheet = useMobileNavStore((s) => s.closeSheet);
  const push = useMobileNavStore((s) => s.push);
  const setTab = useMobileNavStore((s) => s.setTab);
  const connections = useAllConnections();
  const conn = connections.find((c) => c.id === hostId);
  const saveConnection = useConnectionStore((s) => s.saveConnection);
  const updateConnection = useConnectionStore((s) => s.updateConnection);
  const deleteConnection = useConnectionStore((s) => s.deleteConnection);
  const connect = useSessionStore((s) => s.connect);
  const vaults = useVaultStore((s) => s.vaults);
  const [mode, setMode] = useState<Mode>("menu");

  if (!conn) return null;
  const name = connectionDisplayName(conn);
  const isSerial = conn.connection_type === "serial" || !!conn.serial_port;
  const currentVaultId = conn.vault_id ?? "personal";
  const moveTargets = vaults.filter((v) => v.id !== currentVaultId);

  const Row = ({ it }: { it: Item }) => (
    <button
      data-host-action={it.label.toLowerCase().replace(/[^a-z]+/g, "-")}
      className="w-full flex items-center gap-3 px-3 py-3.5 rounded-xl text-left active:bg-(--t-bg-card)"
      style={{ color: it.danger ? "var(--t-danger, #e5484d)" : "var(--t-text-primary)" }}
      onClick={it.onTap}
    >
      <Icon icon={it.icon} width={18} />
      <span className="text-sm font-medium">{it.label}</span>
    </button>
  );

  if (mode === "confirm-delete") {
    return (
      <BottomSheet title="Delete host?" onClose={closeSheet}>
        <div className="px-3 pt-1 pb-2 text-sm text-(--t-text-dim)">
          Permanently delete <span className="text-(--t-text-primary) font-medium">{name}</span>? This can’t be undone.
        </div>
        <Row it={{ icon: "lucide:trash-2", label: "Delete", danger: true, onTap: () => { void deleteConnection(hostId); closeSheet(); } }} />
        <Row it={{ icon: "lucide:x", label: "Cancel", onTap: () => setMode("menu") }} />
      </BottomSheet>
    );
  }

  if (mode === "move") {
    return (
      <BottomSheet title="Move to vault" onClose={closeSheet}>
        {moveTargets.map((v) => (
          <Row key={v.id} it={{ icon: "lucide:vault", label: v.name, onTap: () => {
            void updateConnection(hostId, { ...connectionToFormData(conn), vault_id: v.id });
            closeSheet();
          } }} />
        ))}
        <Row it={{ icon: "lucide:arrow-left", label: "Back", onTap: () => setMode("menu") }} />
      </BottomSheet>
    );
  }

  const items: Item[] = [
    ...(!isSerial ? [{ icon: "lucide:terminal", label: "Connect", onTap: () => { closeSheet(); void connect(hostId).catch(console.error); setTab("terminal"); } }] : []),
    { icon: "lucide:pencil", label: "Edit", onTap: () => { closeSheet(); push({ kind: "host-edit", hostId }); } },
    ...(!isSerial ? [{ icon: "lucide:folder-open", label: "SFTP", onTap: () => { closeSheet(); push({ kind: "panel-sftp", connectionId: hostId }); } }] : []),
    ...(conn.host ? [{ icon: "lucide:clipboard-copy", label: "Copy address", onTap: () => {
      void writeClipboard(conn.host);
      useNotificationStore.getState().addToast({ pluginId: "core", pluginName: "Voltius", type: "toast", message: `Copied ${conn.host}`, severity: "success", duration: 2000 });
      closeSheet();
    } }] : []),
    { icon: "lucide:copy", label: "Duplicate", onTap: () => {
        void saveConnection({ ...connectionToFormData(conn), name: `${name} copy` });
        closeSheet();
      } },
    ...(moveTargets.length > 0 ? [{ icon: "lucide:folder-input", label: "Move to vault", onTap: () => setMode("move") }] : []),
    { icon: "lucide:trash-2", label: "Delete", danger: true, onTap: () => setMode("confirm-delete") },
  ];

  return (
    <BottomSheet title={name} onClose={closeSheet}>
      {items.map((it) => <Row key={it.label} it={it} />)}
    </BottomSheet>
  );
}
