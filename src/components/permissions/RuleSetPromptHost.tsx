import { useTranslation } from "react-i18next";
import { ConfirmModal } from "@/components/shared/ConfirmModal";
import { useRuleSetPromptStore } from "@/stores/ruleSetPromptStore";
import { useTeamStore } from "@/stores/teamStore";
import { permissionLabel, ruleSubjectLabel } from "@/components/members/roleChips";
import { ruleSubjectKey, type RuleSubject } from "@/services/permissions";

export function RuleSetPromptHost() {
  const { t } = useTranslation();
  const head = useRuleSetPromptStore((s) => s.queue[0]);
  const answer = useRuleSetPromptStore((s) => s.answer);
  const rolesByTeam = useTeamStore((s) => s.rolesByTeam);
  const membersByTeam = useTeamStore((s) => s.membersByTeam);
  if (!head) return null;
  const { prompt } = head;
  const subjectName = (s: RuleSubject) =>
    ruleSubjectLabel(t, s, rolesByTeam[prompt.teamId] ?? [], membersByTeam[prompt.teamId] ?? []);

  return (
    <ConfirmModal
      tone="warning"
      title={t("shared.permissions.moveWarning.title")}
      message={t(prompt.changes ? "shared.permissions.moveWarning.body" : "shared.permissions.moveWarning.bodyUnknown")}
      confirmLabel={t("shared.permissions.moveWarning.confirm")}
      onConfirm={() => answer(true)}
      onCancel={() => answer(false)}
    >
      {prompt.changes && (
        <ul className="text-xs text-(--t-text-secondary) space-y-1 max-h-48 overflow-y-auto">
          {prompt.changes.flatMap((c) => c.bits.map((b) => (
            <li key={`${ruleSubjectKey(c.subject)}:${b.permission}`}>
              {t("shared.permissions.moveWarning.line", {
                subject: subjectName(c.subject),
                permission: permissionLabel(t, b.permission),
                before: t(`members.permissions.state.${b.before}`),
                after: t(`members.permissions.state.${b.after}`),
              })}
            </li>
          )))}
        </ul>
      )}
    </ConfirmModal>
  );
}
