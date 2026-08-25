import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Icon } from "@iconify/react";
import { convertVaultToTeam } from "@/services/vaultConvert";
import { Modal, ModalCard } from "@/components/shared/Modal";

interface Props {
  vaultId: string;
  vaultName: string;
  onCancel: () => void;
  onConverted: (teamId: string) => void;
}

const COSTS: { icon: string; color: string; key: string }[] = [
  { icon: "lucide:triangle-alert", color: "var(--t-warn, #f59e0b)", key: "members.convert.offlineWarning" },
  { icon: "lucide:key-round", color: "var(--t-text-dim)", key: "members.convert.keyCustody" },
  { icon: "lucide:arrow-right", color: "var(--t-text-dim)", key: "members.convert.change" },
];

export function ConvertToTeamGate({ vaultId, vaultName, onCancel, onConverted }: Props) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      onConverted(await convertVaultToTeam(vaultId, vaultName));
    } catch {
      // runTeamAction already showed a named error toast.
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onCancel} onEnter={() => void go()}>
      <ModalCard className="p-6 flex flex-col gap-4 min-w-[21.333rem] max-w-[35rem]">
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: "color-mix(in srgb, var(--t-accent) 15%, transparent)" }}
          >
            <Icon icon="lucide:users-round" width={16} className="text-(--t-accent)" />
          </div>
          <h2 className="text-sm font-semibold text-(--t-text-bright)">
            {t("members.convert.title", { vault: vaultName })}
          </h2>
        </div>

        <p className="text-sm text-(--t-text-secondary)">{t("members.convert.body")}</p>

        <ul className="flex flex-col gap-2">
          {COSTS.map(({ icon, color, key }) => (
            <li key={key} className="flex items-start gap-2 text-xs text-(--t-text-secondary)">
              <Icon icon={icon} width={13} style={{ color, flexShrink: 0, marginTop: 1 }} />
              <span>{t(key)}</span>
            </li>
          ))}
        </ul>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            disabled={busy}
            className="btn btn-secondary px-4 py-2 rounded-lg text-sm font-medium"
          >
            {t("members.convert.cancel")}
          </button>
          <button
            onClick={() => void go()}
            disabled={busy}
            className="btn px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: "var(--t-accent)", color: "var(--t-on-accent, #fff)" }}
          >
            {t("members.convert.confirm")}
          </button>
        </div>
      </ModalCard>
    </Modal>
  );
}
