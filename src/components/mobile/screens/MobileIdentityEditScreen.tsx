import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import MobileEditHeader from "../MobileEditHeader";
import { IdentityForm } from "@/components/keychain/IdentityForm";
import { useAllIdentities } from "@/hooks/useAllIdentities";
import { useVaultScope } from "@/hooks/useVaultScope";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useCloseWhenGone } from "@/hooks/useCloseWhenGone";
import { saveIdentityFromForm } from "@/services/keychainForm";

export default function MobileIdentityEditScreen({ identityId }: { identityId?: string }) {
  const { t } = useTranslation();
  const pop = useMobileNavStore((s) => s.pop);
  const identities = useAllIdentities();
  const { createVaultId } = useVaultScope();
  const [editingId, setEditingId] = useState<string | undefined>(identityId);
  const editing = editingId ? identities.find((i) => i.id === editingId) ?? null : null;
  useCloseWhenGone(editingId, editing !== null, pop);
  const flushRef = useRef<(() => void) | null>(null);
  const inlineKeyIdRef = useRef<string | null>(null);

  const flushAndPop = () => {
    flushRef.current?.();
    pop();
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      <MobileEditHeader
        title={editing ? t("keychain.identityForm.titleEdit") : t("keychain.toolbar.newIdentity")}
        onBack={flushAndPop}
        onSave={flushAndPop}
        saveAttr="mobile-identity-save"
      />
      <div className="flex-1 overflow-y-auto relative">
        <IdentityForm
          hideChrome
          initial={editing ?? undefined}
          flushRef={flushRef}
          onSubmit={async (data, password, inlineKeyMaterial) => {
            const saved = await saveIdentityFromForm(
              editing, data, password, inlineKeyMaterial, inlineKeyIdRef, createVaultId,
            );
            if (!editing) setEditingId(saved.id);
          }}
          onClose={pop}
        />
      </div>
    </div>
  );
}
