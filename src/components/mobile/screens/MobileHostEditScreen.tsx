import { Icon } from "@iconify/react";
import ConnectionForm from "@/components/connections/ConnectionForm";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useVaultStore } from "@/stores/vaultStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { saveHostFromForm } from "@/services/hostForm";

export default function MobileHostEditScreen({ hostId }: { hostId?: string }) {
  const pop = useMobileNavStore((s) => s.pop);
  const connections = useAllConnections();
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  const editing = hostId ? connections.find((c) => c.id === hostId) ?? null : null;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      <header
        className="shrink-0 flex items-center gap-2 px-2 h-12 border-b"
        style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}
      >
        <button data-mobile-back onClick={pop} className="p-2 text-(--t-text-primary)">
          <Icon icon="lucide:arrow-left" width={22} />
        </button>
        <span className="text-base font-semibold text-(--t-text-primary)">
          {editing ? "Edit host" : "New host"}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto relative">
        <ConnectionForm
          initial={editing ?? undefined}
          onSubmit={async (data, password, privateKey, passphrase) => {
            await saveHostFromForm(editing, data, password, privateKey, passphrase, selectedVaultIds[0] ?? "personal");
            pop();
          }}
          onClose={pop}
          vaults={[]}
          canEdit={true}
        />
      </div>
    </div>
  );
}
