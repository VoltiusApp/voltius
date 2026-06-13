import { useRef, useState } from "react";
import { Icon } from "@iconify/react";
import ConnectionForm, { type ConnectionFormHandle } from "@/components/connections/ConnectionForm";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useVaultStore } from "@/stores/vaultStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { saveHostFromForm } from "@/services/hostForm";

export default function MobileHostEditScreen({ hostId }: { hostId?: string }) {
  const pop = useMobileNavStore((s) => s.pop);
  const connections = useAllConnections();
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  // Track the edited host id locally: a new host's first autosave CREATES a connection,
  // and we must switch to editing it so later debounce fires UPDATE rather than create
  // duplicates (mirrors desktop HostsPage.handleSubmit).
  const [editingId, setEditingId] = useState<string | undefined>(hostId);
  const editing = editingId ? connections.find((c) => c.id === editingId) ?? null : null;
  const formRef = useRef<ConnectionFormHandle>(null);

  // Both exits flush any pending autosave debounce before leaving so a last-keystroke
  // edit is never lost; pop() unmounts the screen, so no re-entrancy guard is needed.
  const flushAndPop = () => {
    formRef.current?.flush();
    pop();
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      <header
        className="shrink-0 flex items-center gap-2 px-2 h-12 border-b"
        style={{ background: "var(--t-bg-chrome)", borderColor: "var(--t-border)" }}
      >
        <button
          data-mobile-back
          onClick={flushAndPop}
          className="p-2 text-(--t-text-primary)"
        >
          <Icon icon="lucide:arrow-left" width={22} />
        </button>
        <span className="flex-1 text-base font-semibold text-(--t-text-primary)">
          {editing ? "Edit host" : "New host"}
        </span>
        <button
          data-mobile-host-save
          onClick={flushAndPop}
          className="px-3 py-1.5 rounded-lg text-sm font-semibold"
          style={{ background: "var(--t-accent)", color: "#fff" }}
        >
          Save
        </button>
      </header>
      <div className="flex-1 overflow-y-auto relative">
        <ConnectionForm
          ref={formRef}
          hideChrome
          initial={editing ?? undefined}
          onSubmit={async (data, password, privateKey, passphrase) => {
            const saved = await saveHostFromForm(editing, data, password, privateKey, passphrase, selectedVaultIds[0] ?? "personal");
            if (!editing && saved) setEditingId(saved.id);
          }}
          onClose={pop}
          vaults={[]}
          canEdit={true}
        />
      </div>
    </div>
  );
}
