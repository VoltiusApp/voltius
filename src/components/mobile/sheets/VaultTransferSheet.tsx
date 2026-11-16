import { useTranslation } from "react-i18next";
import BottomSheet from "./BottomSheet";
import { SheetActionRow } from "./SheetActionRow";
import { VaultCascadeModal } from "@/components/shared/VaultCascadeModal";
import { useVaultTransfer } from "@/hooks/useVaultTransfer";
import type { VaultObjectTab } from "@/services/clipboard/vaultObjectsAdapter";

/** The vault picker behind a sheet's "move/copy to vault", carrying what the objects reference along. */
export default function VaultTransferSheet({ tab, ids, mode, targets, attr, onBack, onClose }: {
  tab: VaultObjectTab;
  ids: string[];
  mode: "copy" | "cut";
  targets: { id: string; name: string }[];
  /** The calling sheet's row attribute, so its automation handles stay put. */
  attr: string;
  onBack: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { pending, accept, cancel, transfer } = useVaultTransfer(tab);
  const copy = mode === "copy";

  return (
    <BottomSheet title={copy ? t("mobile.sheets.shared.copyToVault") : t("mobile.sheets.shared.moveToVault")} onClose={onClose}>
      {targets.map((v) => (
        <SheetActionRow key={v.id} attr={attr} it={{
          icon: copy ? "lucide:copy" : "lucide:vault",
          label: v.name,
          onTap: () => { void transfer(ids, v, mode).then(onClose); },
        }} />
      ))}
      <SheetActionRow attr={attr} it={{ icon: "lucide:arrow-left", label: t("mobile.sheets.shared.back"), slug: "back", onTap: onBack }} />
      {pending && <VaultCascadeModal cascade={pending} onConfirm={accept} onCancel={cancel} />}
    </BottomSheet>
  );
}
