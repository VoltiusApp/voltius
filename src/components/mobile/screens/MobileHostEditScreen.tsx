import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import MobileEditHeader from "../MobileEditHeader";
import ConnectionForm, { type ConnectionFormHandle } from "@/components/connections/ConnectionForm";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useVaultStore } from "@/stores/vaultStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { saveHostFromForm } from "@/services/hostForm";

export default function MobileHostEditScreen({ hostId }: { hostId?: string }) {
  const { t } = useTranslation();
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
      <MobileEditHeader
        title={editing ? t("mobile.host.editTitle") : t("mobile.host.newTitle")}
        onBack={flushAndPop}
        onSave={flushAndPop}
        saveAttr="mobile-host-save"
      />
      <div className="flex-1 overflow-y-auto relative">
        <ConnectionForm
          ref={formRef}
          hideChrome
          initial={editing ?? undefined}
          onSubmit={async (data, secrets) => {
            const saved = await saveHostFromForm(editing, data, secrets, selectedVaultIds[0] ?? "personal");
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
