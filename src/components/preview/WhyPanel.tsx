import { useEffect, useState } from "react";
import { Icon } from "@iconify/react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { FormSection } from "@/components/shared/Panel";
import { hostAddress, hostDisplayName } from "@/components/home/hostDisplay";
import { permissionLabel, roleLabel } from "@/components/members/roleChips";
import { useSubjectLabel } from "@/components/preview/PreviewScope";
import { ObjectRulesModal } from "@/components/preview/ObjectRulesModal";
import { useOwnPermissions } from "@/hooks/usePermission";
import { useRuleSet } from "@/hooks/useRuleSet";
import { explainBit, type Explanation, type ExplainStep, type StepKind } from "@/services/permissionExplain";
import { OBJECT_RULE_ROWS, PERM_BITS, RULE_LAYER_ORDER, type Permission } from "@/services/permissions";
import { previewSideOf, previewSubjectUserId, subjectMembers, subjectRoles } from "@/services/previewSnapshot";
import { ruleSetOwner } from "@/services/ruleSetPointers";
import { findTeamItem } from "@/services/teamObjectPersistence";
import type { TeamObjectType } from "@/services/teamObjects";
import type { TeamRole } from "@/services/teamService";
import { usePreviewStore } from "@/stores/previewStore";
import { useTeamObjectAccessStore } from "@/stores/teamObjectAccessStore";
import { useTeamStore } from "@/stores/teamStore";
import type { Connection } from "@/types";

interface Sentence { key: string; params?: Record<string, string> }
interface SentenceContext { name: string; folder: string; roles: (ids?: string[]) => string }
interface ItemLabel { name: string; detail?: string }

const STEP_ORDER: StepKind[] = [
  "roles", "teamAllow", "teamDeny", "administrator", "ruleNotShown", ...RULE_LAYER_ORDER.map((l) => l.kind), "noView", "needsConnect",
];
const ACTION_BUTTON = "btn btn-secondary px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50";
const RULE_NOT_SHOWN: ExplainStep = { kind: "ruleNotShown", effect: "remove" };

const stepSentence = (step: ExplainStep, ctx: SentenceContext): Sentence => ({
  key: `members.viewAs.why.step.${step.kind}`,
  params: { name: ctx.name, roles: ctx.roles(step.roleIds), folder: ctx.folder },
});

function rowSentence(e: Explanation, allowed: boolean, notShown: boolean, ctx: SentenceContext): Sentence {
  if (e.allowed !== allowed) return notShown ? stepSentence(RULE_NOT_SHOWN, ctx) : { key: "members.viewAs.why.decidedByServer" };
  return e.decidedBy ? stepSentence(e.decidedBy, ctx) : { key: "members.viewAs.why.notGranted", params: { name: ctx.name } };
}

function addsUp(rows: { permission: Permission; e: Explanation }[], ctx: SentenceContext) {
  const lines = new Map<string, { sentence: Sentence; order: number; permissions: Permission[] }>();
  for (const { permission, e } of rows) {
    for (const step of e.steps) {
      const sentence = stepSentence(step, ctx);
      const id = `${sentence.key}:${JSON.stringify(sentence.params)}`;
      const line = lines.get(id) ?? { sentence, order: STEP_ORDER.indexOf(step.kind), permissions: [] };
      line.permissions.push(permission);
      lines.set(id, line);
    }
  }
  return [...lines.entries()].sort(([, a], [, b]) => a.order - b.order);
}

const labelOf = (type: TeamObjectType, item: { name?: string }): ItemLabel =>
  type === "connection"
    ? { name: hostDisplayName(item as Connection), detail: hostAddress(item as Connection) || undefined }
    : { name: item.name ?? "" };

function useItemLabel(teamId: string, type: TeamObjectType, id: string): ItemLabel | null {
  const [label, setLabel] = useState<{ id: string; label: ItemLabel | null } | null>(null);
  useEffect(() => {
    let live = true;
    findTeamItem(teamId, type, id)
      .then((item) => { if (live) setLabel({ id, label: item ? labelOf(type, item) : null }); })
      .catch(console.error);
    return () => { live = false; };
  }, [teamId, type, id]);
  return label?.id === id ? label.label : null;
}

const roleNames = (t: TFunction, roles: TeamRole[]) => (ids?: string[]) =>
  ids?.length
    ? ids.map((id) => roleLabel(t, roles.find((r) => r.id === id)?.name ?? "?")).join(", ")
    : t("members.viewAs.why.someRole");

export function WhyPanel() {
  const { t } = useTranslation();
  const side = usePreviewStore((s) => s.side);
  const session = usePreviewStore((s) => s.session);
  const result = usePreviewStore((s) => s.result);
  const resultDraft = usePreviewStore((s) => s.resultDraft);
  const name = useSubjectLabel();
  const teamId = session?.teamId ?? "";
  const members = useTeamStore((s) => s.membersByTeam[teamId]);
  const teamRoles = useTeamStore((s) => s.rolesByTeam[teamId]);
  const entries = useTeamObjectAccessStore((s) => s.byTeam[teamId]);
  const can = useOwnPermissions();
  const [editing, setEditing] = useState(false);

  const type = side?.kind === "why" ? side.type : "connection";
  const objectId = side?.kind === "why" ? side.objectId : "";
  const shown = result ? previewSideOf(result, objectId) : null;
  const object = shown?.objects[objectId];
  const setId = object?.rule_set_id ?? null;
  const layers = setId === null || !shown ? null : setId in shown.rule_sets ? shown.rule_sets[setId] : "notShown";
  const ruleSet = useRuleSet(teamId, layers && layers !== "notShown" ? setId : null);
  const ownerId = (setId && entries && ruleSetOwner(entries, setId)) || objectId;
  const ownerType = entries?.[ownerId]?.type ?? type;
  const item = useItemLabel(teamId, type, objectId);
  const owner = useItemLabel(teamId, ownerType, ownerId);

  if (!session || !result || !object || side?.kind !== "why") return null;
  const subjectId = previewSubjectUserId(session.subject);
  const member = subjectMembers(teamId, members ?? [], session.subject, resultDraft).find((m) => m.user_id === subjectId);
  if (!member) return null;

  const roles = subjectRoles(teamRoles ?? [], session.subject, resultDraft);
  const ruleEntries = ruleSet.status === "ok" && ruleSet.setId === setId ? ruleSet.entries : undefined;
  const itemName = item?.name || t("members.viewAs.why.thisItem");
  const folder = owner?.name || itemName;
  const ctx: SentenceContext = { name, folder, roles: roleNames(t, roles) };
  const rows = OBJECT_RULE_ROWS[type].map((permission) => {
    const allowed = (object.mask & PERM_BITS[permission]) !== 0;
    const e = explainBit(PERM_BITS[permission], { roles, member, layers, locked: result.locked, entries: ruleEntries });
    return { permission, allowed, e, sentence: rowSentence(e, allowed, layers === "notShown", ctx) };
  });
  const lines = addsUp(rows, ctx);
  const mayEdit = can("MANAGE_ROLES", session.vaultId, ownerId);
  const lockedReason = mayEdit ? null : t("members.viewAs.why.editRulesLocked", { folder });

  return (
    <div data-testid="why-panel" className="p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold text-(--t-text-primary)">{itemName}</p>
        <p className="text-[11px] text-(--t-text-dim)">
          {t("members.viewAs.why.as", { name })}{item?.detail && ` · ${item.detail}`}
        </p>
      </div>

      <FormSection label={t("members.viewAs.why.gets", { name })}>
        <div className="space-y-1.5">
          {rows.map(({ permission, allowed, sentence }) => (
            <div key={permission} data-testid={`why-row-${permission}`} data-allowed={String(allowed)}>
              <p className="flex items-center gap-1.5 text-xs" style={{ color: allowed ? "var(--t-text-primary)" : "var(--t-text-dim)" }}>
                <Icon icon={allowed ? "lucide:check" : "lucide:x"} width={11} />
                {permissionLabel(t, permission)}
              </p>
              <p className="pl-[17px] text-[11px] text-(--t-text-dim)">{t(sentence.key, sentence.params)}</p>
            </div>
          ))}
        </div>
      </FormSection>

      <FormSection label={t("members.viewAs.why.addsUp")}>
        <ol data-testid="why-steps" className="space-y-1 text-[11px] text-(--t-text-secondary)">
          {lines.map(([id, { sentence, permissions }]) => (
            <li key={id}>
              <span>{t(sentence.key, sentence.params)}</span>
              <span className="text-(--t-text-dim)"> · {permissions.map((p) => permissionLabel(t, p)).join(", ")}</span>
            </li>
          ))}
        </ol>
        <p className="text-[10px] text-(--t-text-dim)">{t("members.viewAs.why.order", { name })}</p>
      </FormSection>

      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          disabled={!mayEdit}
          title={lockedReason ?? undefined}
          onClick={() => setEditing(true)}
          className={ACTION_BUTTON}
        >
          {t("members.viewAs.why.editRules", { folder })}
        </button>
        {lockedReason && <p className="text-[10px] text-(--t-text-dim)">{lockedReason}</p>}
        <button
          type="button"
          onClick={() => usePreviewStore.getState().showAccess()}
          className={ACTION_BUTTON}
        >
          {t("members.viewAs.why.editAccess", { name })}
        </button>
      </div>

      {editing && (
        <ObjectRulesModal
          objectId={ownerId}
          type={ownerType}
          vaultId={session.vaultId}
          title={t("members.viewAs.why.editRules", { folder })}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
