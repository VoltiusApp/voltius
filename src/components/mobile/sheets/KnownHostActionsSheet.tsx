import { useState } from "react";
import { Icon } from "@iconify/react";
import BottomSheet from "./BottomSheet";
import { useKnownHostStore } from "@/stores/knownHostStore";
import { useVaultStore } from "@/stores/vaultStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { writeClipboard } from "@/utils/clipboard";
import type { KnownHost } from "@/types";

type Mode = "menu" | "confirm-delete" | "move" | "copy";

type Item = { icon: string; label: string; danger?: boolean; onTap: () => void };

export default function KnownHostActionsSheet({ host, onClose }: { host: KnownHost; onClose: () => void }) {
  const removeKnownHost = useKnownHostStore((s) => s.removeKnownHost);
  const moveKnownHostVault = useKnownHostStore((s) => s.moveKnownHostVault);
  const copyKnownHostVault = useKnownHostStore((s) => s.copyKnownHostVault);
  const vaults = useVaultStore((s) => s.vaults);
  const [mode, setMode] = useState<Mode>("menu");

  const currentVaultId = host.vault_id ?? "personal";
  const otherVaults = vaults.filter((v) => v.id !== currentVaultId);

  const displayName = host.name ?? `${host.host}:${host.port}`;

  const Row = ({ it }: { it: Item }) => (
    <button
      data-knownhost-action={it.label.toLowerCase().replace(/[^a-z]+/g, "-")}
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
      <BottomSheet title="Delete known host?" onClose={onClose}>
        <div className="px-3 pt-1 pb-2 text-sm text-(--t-text-dim)">
          This removes the trusted fingerprint. The next connection to this host will be treated as new.
        </div>
        <Row it={{ icon: "lucide:trash-2", label: "Delete", danger: true, onTap: () => { void removeKnownHost(host.id); onClose(); } }} />
        <Row it={{ icon: "lucide:x", label: "Cancel", onTap: () => setMode("menu") }} />
      </BottomSheet>
    );
  }

  if (mode === "move") {
    return (
      <BottomSheet title="Move to vault" onClose={onClose}>
        {otherVaults.map((v) => (
          <Row key={v.id} it={{ icon: "lucide:vault", label: v.name, onTap: () => { void moveKnownHostVault(host.id, v.id); onClose(); } }} />
        ))}
        <Row it={{ icon: "lucide:arrow-left", label: "Back", onTap: () => setMode("menu") }} />
      </BottomSheet>
    );
  }

  if (mode === "copy") {
    return (
      <BottomSheet title="Copy to vault" onClose={onClose}>
        {otherVaults.map((v) => (
          <Row key={v.id} it={{ icon: "lucide:vault", label: v.name, onTap: () => { void copyKnownHostVault(host.id, v.id); onClose(); } }} />
        ))}
        <Row it={{ icon: "lucide:arrow-left", label: "Back", onTap: () => setMode("menu") }} />
      </BottomSheet>
    );
  }

  const items: Item[] = [
    {
      icon: "lucide:fingerprint",
      label: "Copy fingerprint",
      onTap: () => {
        void writeClipboard(host.fingerprint);
        useNotificationStore.getState().addToast({ pluginId: "core", pluginName: "Voltius", type: "toast", message: "Copied fingerprint", severity: "success", duration: 2000 });
        onClose();
      },
    },
    ...(otherVaults.length > 0 ? [{ icon: "lucide:folder-input", label: "Move to vault", onTap: () => setMode("move") }] : []),
    ...(otherVaults.length > 0 ? [{ icon: "lucide:copy", label: "Copy to vault", onTap: () => setMode("copy") }] : []),
    { icon: "lucide:trash-2", label: "Delete", danger: true, onTap: () => setMode("confirm-delete") },
  ];

  return (
    <BottomSheet title={displayName} onClose={onClose}>
      {items.map((it) => <Row key={it.label} it={it} />)}
    </BottomSheet>
  );
}
