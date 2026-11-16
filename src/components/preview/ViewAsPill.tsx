import { useEffect } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import { FloatingPill, escapeIsFree } from "@/components/shared/FloatingPill";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { usePreviewStore, saveNeedsConfirm } from "@/stores/previewStore";
import { useTeamStore } from "@/stores/teamStore";
import { useSubjectLabel } from "@/components/preview/PreviewScope";
import { memberLabel } from "@/services/memberLabel";
import { unsavedChangeCount } from "@/services/viewAsSave";
import type { TeamMember, TeamRole } from "@/services/teamService";

function useSubjectRecord(): TeamMember | TeamRole | undefined {
  const session = usePreviewStore((s) => s.session);
  return useTeamStore((s) => {
    if (!session) return undefined;
    const { subject, teamId } = session;
    return subject.type === "member"
      ? s.membersByTeam[teamId]?.find((m) => m.user_id === subject.user_id)
      : s.rolesByTeam[teamId]?.find((r) => r.id === subject.role_id);
  });
}

function ViewAsSaveConfirm() {
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

export function ViewAsPill() {
  const { t } = useTranslation();
  const draft = usePreviewStore((s) => s.draft);
  const result = usePreviewStore((s) => s.result);
  const saving = usePreviewStore((s) => s.saving);
  const saveError = usePreviewStore((s) => s.saveError);
  const name = useSubjectLabel();
  const current = useSubjectRecord();

  useEffect(() => {
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && escapeIsFree(e)) usePreviewStore.getState().exit();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, []);

  const { exit, setDraft, requestSave } = usePreviewStore.getState();
  const count = draft ? unsavedChangeCount(draft, current) : 0;
  const keyGate = saveNeedsConfirm(result) !== null;
  const changed = draft && "permissions" in draft && !keyGate ? result?.affected?.changed.length ?? 0 : 0;

  return (
    <>
      <FloatingPill testId="view-as-pill">
        <Icon icon="lucide:scan-eye" width={14} style={{ color: "var(--t-accent)" }} />
        <span>{t("members.viewAs.viewingAs", { name })}</span>
        {draft && (
          <>
            <span style={{ color: "var(--t-text-dim)" }}>·</span>
            <span style={{ color: "var(--t-text-dim)" }}>{t("members.viewAs.unsaved", { count })}</span>
            <button data-testid="view-as-discard" className="btn btn-ghost" disabled={saving} onClick={() => setDraft(null)}>
              {t("members.viewAs.discard")}
            </button>
            {changed > 0 && <span style={{ color: "var(--t-text-dim)" }}>{t("members.viewAs.changesAccess", { count: changed })}</span>}
            <button
              data-testid="view-as-save"
              className={`btn ${keyGate ? "btn-warning" : "btn-primary"}`}
              disabled={saving}
              onClick={() => void requestSave()}
            >
              {keyGate ? t("members.viewAs.saveConfirm") : t("members.viewAs.save")}
            </button>
            <span className="self-stretch w-px" style={{ background: "var(--t-border)" }} />
          </>
        )}
        {saveError && <span style={{ color: "var(--t-status-error)" }}>{saveError}</span>}
        <button data-testid="view-as-exit" className="btn btn-ghost" disabled={saving} onClick={exit}>
          {t("members.viewAs.exit")}
        </button>
      </FloatingPill>
      <ViewAsSaveConfirm />
    </>
  );
}
