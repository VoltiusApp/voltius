import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, ModalCard } from "@/components/shared/Modal";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultContents } from "@/hooks/useVaultContents";
import { useVaultAdminActions } from "./useVaultAdminActions";
import { VaultSettingsBody } from "./VaultSettingsBody";
import type { VaultAdminTarget } from "./vaultAdminTarget";

export type VaultDialog = "rename" | "settings" | "makePrivate" | "delete" | null;

export function VaultAdminDialogs({
  target, dialog, onClose, onRenamed, onDone,
}: {
  target: VaultAdminTarget;
  dialog: VaultDialog;
  onClose: () => void;
  onRenamed?: (name: string) => void;
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const { membersByTeam } = useTeamStore();
  const counts = useVaultContents(target.vaultId ?? undefined);
  const { busy, rename, remove, makePrivate } = useVaultAdminActions(target, {
    onRenamed,
    onDone: () => { onClose(); onDone?.(); },
  });
  const [draft, setDraft] = useState(target.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const [escalated, setEscalated] = useState<"makePrivate" | "delete" | null>(null);

  useEffect(() => {
    if (dialog === "rename") { setDraft(target.name); inputRef.current?.focus(); }
  }, [dialog, target.name]);

  useEffect(() => { if (!dialog) setEscalated(null); }, [dialog]);

  const effective = dialog === "settings" && escalated ? escalated : dialog;
  const cancelConfirm = () => (escalated ? setEscalated(null) : onClose());

  if (!dialog) return null;

  if (effective === "rename") {
    const commit = () => {
      if (!draft.trim()) return;
      rename(draft);
      onClose();
    };
    return (
      <Modal onClose={onClose} onEnter={commit}>
        <ModalCard className="p-6 flex flex-col gap-4 min-w-[21.333rem]">
          <label htmlFor="vault-rename" className="text-xs font-bold uppercase tracking-widest text-(--t-text-dim)">
            {t("settings.vaults.general.vaultNameLabel")}
          </label>
          <input
            id="vault-rename"
            ref={inputRef}
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="form-input px-3 py-2 rounded-lg text-sm outline-hidden"
            style={{ background: "var(--t-bg-input)", border: "1px solid var(--t-border)", color: "var(--t-text-primary)" }}
          />
          <div className="flex gap-2 justify-end">
            <button onClick={onClose} className="btn btn-secondary px-4 py-2 rounded-lg text-sm font-medium">
              {t("common.action.cancel")}
            </button>
            <button onClick={commit} disabled={!draft.trim()} className="btn btn-primary px-4 py-2 rounded-lg text-sm font-medium">
              {t("settings.vaults.general.save")}
            </button>
          </div>
        </ModalCard>
      </Modal>
    );
  }

  if (effective === "delete") {
    const items = counts.filter((c) => c.count > 0).map((c) => c.count).reduce((a, b) => a + b, 0);
    return (
      <ConfirmModal
        title={t("settings.vaults.general.deleteVault.title")}
        message={t("settings.vaults.general.deleteVault.confirmDesc", { count: items })}
        confirmLabel={t("settings.vaults.general.deleteVault.confirmBtn")}
        busy={busy}
        busyLabel={t("settings.vaults.general.deleteVault.deleting")}
        onConfirm={() => void remove()}
        onCancel={cancelConfirm}
      />
    );
  }

  if (effective === "makePrivate") {
    const memberN = target.teamId ? (membersByTeam[target.teamId]?.length ?? 0) : 0;
    return (
      <ConfirmModal
        tone="warning"
        title={t("settings.vaults.general.makePrivate.title")}
        message={memberN > 1
          ? t("settings.vaults.general.makePrivate.confirm", { count: memberN - 1 })
          : t("settings.vaults.general.makePrivate.confirmAll")}
        confirmLabel={t("settings.vaults.general.makePrivate.confirmBtn")}
        busy={busy}
        busyLabel={t("settings.vaults.general.makePrivate.converting")}
        onConfirm={() => void makePrivate()}
        onCancel={cancelConfirm}
      />
    );
  }

  return (
    <Modal onClose={onClose}>
      <ModalCard solid className="p-6 min-w-[24rem] max-w-[30rem]">
        <VaultSettingsBody
          target={target}
          onRenamed={(n) => onRenamed?.(n)}
          onDone={() => { onClose(); onDone?.(); }}
          onRequestDialog={setEscalated}
        />
      </ModalCard>
    </Modal>
  );
}
