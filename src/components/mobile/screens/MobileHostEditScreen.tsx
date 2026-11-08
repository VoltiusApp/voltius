import { useRef } from "react";
import { useTranslation } from "react-i18next";
import MobileEditScreen, { useAutosaveExit } from "../MobileEditScreen";
import ConnectionForm, { type ConnectionFormHandle } from "@/components/connections/ConnectionForm";
import { useAllConnections } from "@/hooks/useAllConnections";
import { useVaultScope } from "@/hooks/useVaultScope";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useEditedItem } from "@/hooks/useEditedItem";
import { saveHostFromForm } from "@/services/hostForm";
import type { NewObjectPlacement } from "@/types";

/**
 * New / edit host. Autosaves (create included: the first valid pass creates the host),
 * so there is no Save button; ⋮ opens the host's actions once it exists.
 */
export default function MobileHostEditScreen({ hostId, placement }: { hostId?: string; placement?: NewObjectPlacement }) {
  const { t } = useTranslation();
  const pop = useMobileNavStore((s) => s.pop);
  const openSheet = useMobileNavStore((s) => s.openSheet);
  const { createVaultId } = useVaultScope();
  const { editing, gone, onCreated } = useEditedItem(useAllConnections(), hostId, pop);
  const formRef = useRef<ConnectionFormHandle>(null);
  const exit = useAutosaveExit();

  return (
    <MobileEditScreen
      form="host"
      title={editing ? t("mobile.host.editTitle") : t("mobile.host.newTitle")}
      // Flush any pending autosave debounce so a last-keystroke edit is never lost.
      onLeave={() => { formRef.current?.flush(); pop(); }}
      onDiscard={pop}
      onOverflow={editing ? () => openSheet({ kind: "host-actions", hostId: editing.id, fromEditor: true }) : undefined}
      {...exit.screenProps}
    >
      <ConnectionForm
        ref={formRef}
        hideChrome
        {...exit.formProps}
        initial={editing ?? undefined}
        placement={placement}
        onSubmit={(data, secrets) => (gone ? undefined : saveHostFromForm(editing, data, secrets, createVaultId, onCreated))}
        onClose={pop}
        vaults={[]}
      />
    </MobileEditScreen>
  );
}
