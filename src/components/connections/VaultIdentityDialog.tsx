import { useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { useIdentityPickStore } from "@/stores/identityPickStore";
import { useVaultIdentityDialogStore } from "@/stores/vaultIdentityDialogStore";
import { notifyError } from "@/utils/notifyError";
import { useVaultPickChoices } from "@/hooks/useCredentialPlan";
import { useTeamName } from "@/hooks/useTeamName";

function Choice({ icon, title, subtitle, selected, onClick }: { icon: string; title: string; subtitle: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-left bg-(--t-bg-elevated) border"
      style={{ borderColor: selected ? "var(--t-accent)" : "var(--t-border)" }}
    >
      <Icon icon={icon} width={14} className={selected ? "shrink-0 text-(--t-accent)" : "shrink-0 text-(--t-text-dim)"} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-(--t-text-primary) truncate">{title}</p>
        <p className="text-xs text-(--t-text-dim) truncate">{subtitle}</p>
      </div>
      {selected && <Icon icon="lucide:check" width={13} className="text-(--t-accent)" />}
    </button>
  );
}

export function VaultIdentityDialog({ teamId, onClose }: { teamId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const choices = useVaultPickChoices(teamId);
  const current = useIdentityPickStore((s) => s.byTeam[teamId] ?? null);
  const setVaultDefault = useIdentityPickStore((s) => s.setVaultDefault);
  const vault = useTeamName(teamId);
  const [selected, setSelected] = useState<string | null>(current);

  const save = () => {
    void setVaultDefault(teamId, selected).then(onClose, notifyError);
  };

  return (
    <Modal onClose={onClose} onEnter={save}>
      <ModalCard className="p-6 flex flex-col gap-5" style={{ width: "24rem" }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "color-mix(in srgb, var(--t-accent) 18%, transparent)" }}>
            <Icon icon="lucide:user-round-cog" width={18} className="text-(--t-accent)" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-(--t-text-bright)">{t("connections.vaultIdentity.title", { vault })}</h2>
            <p className="text-xs text-(--t-text-dim) mt-0.5">{t("connections.vaultIdentity.subtitle")}</p>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-(--t-text-secondary)">{t("connections.vaultIdentity.useOn", { vault })}</label>
          {choices.map((c) => (
            <Choice key={c.id} icon="lucide:user-round" title={c.name ?? c.username} subtitle={c.username} selected={selected === c.id} onClick={() => setSelected(c.id)} />
          ))}
          <Choice icon="lucide:info" title={t("connections.vaultIdentity.none")} subtitle={t("connections.vaultIdentity.noneHint")} selected={selected === null} onClick={() => setSelected(null)} />
          <p className="text-xs text-(--t-text-dim) mt-1">{t("connections.vaultIdentity.footnote")}</p>
        </div>
        <div className="flex gap-2 justify-end pt-1">
          <button className="btn btn-secondary px-4 py-2 rounded-lg text-sm font-medium" onClick={onClose}>{t("common.action.cancel")}</button>
          <button className="btn btn-primary px-4 py-2 rounded-lg text-sm font-medium" onClick={save}>{t("common.action.save")}</button>
        </div>
      </ModalCard>
    </Modal>
  );
}

export function VaultIdentityDialogHost() {
  const teamId = useVaultIdentityDialogStore((s) => s.teamId);
  const close = useVaultIdentityDialogStore((s) => s.close);
  return teamId ? <VaultIdentityDialog teamId={teamId} onClose={close} /> : null;
}
