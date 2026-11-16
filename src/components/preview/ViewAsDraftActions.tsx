import { useTranslation } from "react-i18next";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { usePreviewStore, saveNeedsConfirm, saveReady } from "@/stores/previewStore";
import { useTeamStore } from "@/stores/teamStore";
import { useSubjectLabel } from "@/components/preview/PreviewScope";
import { memberLabel } from "@/services/memberLabel";
import { unsavedChangeCount } from "@/services/viewAsSave";
import { subjectRecord } from "@/services/previewSnapshot";

export function ViewAsSaveConfirm() {
  const { t } = useTranslation();
  const pending = usePreviewStore((s) => s.pendingConfirm);
  const saving = usePreviewStore((s) => s.saving);
  const lost = usePreviewStore((s) => s.result?.affected?.lose_vault_key);
  const teamId = usePreviewStore((s) => s.session?.teamId);
  const members = useTeamStore((s) => (teamId ? s.membersByTeam[teamId] : undefined));
  const subject = useSubjectLabel();
  const { confirmSave, cancelSave } = usePreviewStore.getState();
  if (!pending) return null;

  const names = (lost ?? []).map((id) => memberLabel(members?.find((m) => m.user_id === id))).join(", ");
  const copy = pending === "memberKeyLoss"
    ? {
        title: t("members.revokeKeyAccess.title", { name: subject }),
        message: t("members.revokeKeyAccess.body", { name: subject }),
        confirmLabel: t("members.revokeKeyAccess.confirm"),
      }
    : {
        title: t("members.viewAs.roleKeyLoss.title"),
        message: t("members.viewAs.roleKeyLoss.body", { names }),
        confirmLabel: t("members.viewAs.roleKeyLoss.confirm"),
      };
  return <ConfirmModal tone="warning" busy={saving} {...copy} onCancel={cancelSave} onConfirm={() => void confirmSave()} />;
}

export function ViewAsDraftActions({ size = "sm" }: { size?: "sm" | "touch" }) {
  const { t } = useTranslation();
  const draft = usePreviewStore((s) => s.draft);
  const result = usePreviewStore((s) => s.result);
  const ready = usePreviewStore(saveReady);
  const saving = usePreviewStore((s) => s.saving);
  const saveError = usePreviewStore((s) => s.saveError);
  const session = usePreviewStore((s) => s.session);
  const current = useTeamStore((s) => subjectRecord(s, session));
  if (!draft) return null;

  const { setDraft, requestSave } = usePreviewStore.getState();
  const count = unsavedChangeCount(draft, current);
  const keyGate = saveNeedsConfirm(result) !== null;
  const changed = "permissions" in draft && !keyGate ? result?.affected?.changed.length ?? 0 : 0;
  const touch = size === "touch";
  const button = touch ? " min-h-12 px-4" : "";
  const note = touch ? "min-w-0 truncate" : undefined;

  return (
    <>
      <span className={touch ? "min-w-0 flex-1 truncate" : undefined} style={{ color: "var(--t-text-dim)" }}>{t("members.viewAs.unsaved", { count })}</span>
      <button data-testid="view-as-discard" className={`btn btn-ghost${button}`} disabled={saving} onClick={() => setDraft(null)}>
        {t("members.viewAs.discard")}
      </button>
      {changed > 0 && <span className={note} style={{ color: "var(--t-text-dim)" }}>{t("members.viewAs.changesAccess", { count: changed })}</span>}
      <button
        data-testid="view-as-save"
        className={`btn ${keyGate ? "btn-warning" : "btn-primary"}${button}`}
        disabled={saving || !ready}
        title={ready ? undefined : t("members.viewAs.loading")}
        onClick={() => void requestSave()}
      >
        {keyGate ? t("members.viewAs.saveConfirm") : t("members.viewAs.save")}
      </button>
      {saveError && <span className={note} style={{ color: "var(--t-status-error)" }}>{saveError}</span>}
    </>
  );
}
