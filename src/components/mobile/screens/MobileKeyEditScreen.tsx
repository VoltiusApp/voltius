import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import MobileEditHeader from "../MobileEditHeader";
import { KeyForm } from "@/components/keychain/KeyForm";
import { useAllKeys } from "@/hooks/useAllKeys";
import { useVaultStore } from "@/stores/vaultStore";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { saveKeyFromForm } from "@/services/keychainForm";

export default function MobileKeyEditScreen({ keyId, mode }: { keyId?: string; mode?: "import" | "generate" }) {
  const { t } = useTranslation();
  const pop = useMobileNavStore((s) => s.pop);
  const keys = useAllKeys();
  const selectedVaultIds = useVaultStore((s) => s.selectedVaultIds);
  // A new key's first autosave CREATES it; switch to editing so later passes update
  // that key rather than minting a second one (mirrors MobileHostEditScreen).
  const [editingId, setEditingId] = useState<string | undefined>(keyId);
  const editing = editingId ? keys.find((k) => k.id === editingId) ?? null : null;
  const flushRef = useRef<(() => void) | null>(null);

  const flushAndPop = () => {
    flushRef.current?.();
    pop();
  };

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-(--t-bg-base)">
      <MobileEditHeader
        title={editing ? t("keychain.keyForm.titleEdit") : t("keychain.toolbar.newKey")}
        onBack={flushAndPop}
        onSave={flushAndPop}
        saveAttr="mobile-key-save"
      />
      <div className="flex-1 overflow-y-auto relative">
        <KeyForm
          hideChrome
          initial={editing ?? undefined}
          initialMode={mode}
          flushRef={flushRef}
          onSubmit={async (data, privateKey, publicKey, passphrase) => {
            const saved = await saveKeyFromForm(editing, data, privateKey, publicKey, passphrase, selectedVaultIds[0] ?? "personal");
            if (!editing) setEditingId(saved.id);
          }}
          onClose={pop}
        />
      </div>
    </div>
  );
}
