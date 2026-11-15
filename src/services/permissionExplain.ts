import type { RuleLayers } from "@/services/permissionPreview";
import { effectivePermissions, foldRuleLayers, PERM_BITS, type RuleEntry, type RuleLayerDef } from "@/services/permissions";
import type { TeamRole } from "@/services/teamService";

export type StepKind =
  | "roles" | "teamAllow" | "teamDeny" | "administrator"
  | RuleLayerDef["kind"]
  | "noView" | "needsConnect" | "ruleNotShown";

export interface ExplainStep { kind: StepKind; effect: "grant" | "remove"; roleIds?: string[] }
export interface Explanation { allowed: boolean; steps: ExplainStep[]; decidedBy: ExplainStep | null }

export interface ExplainInput {
  roles: TeamRole[];
  member: { role_ids: string[]; permission_allow?: number; permission_deny?: number };
  layers: RuleLayers | null | "notShown";
  locked: boolean;
  entries?: RuleEntry[];
}

const SECRET_BITS = PERM_BITS.VIEW_SECRETS | PERM_BITS.COPY_SECRETS;

export function explainBit(bit: number, input: ExplainInput): Explanation {
  const { roles, member, layers, locked, entries } = input;
  const steps: ExplainStep[] = [];
  let on = false;
  const set = (kind: StepKind, next: boolean, roleIds?: string[]) => {
    steps.push({ kind, effect: next ? "grant" : "remove", ...(roleIds && { roleIds }) });
    on = next;
  };
  const done = (): Explanation => ({ allowed: on, steps, decidedBy: steps[steps.length - 1] ?? null });

  const teamDeny = member.permission_deny ?? 0;
  const holders = roles.filter((r) => member.role_ids.includes(r.id) && (!locked || r.is_builtin) && (r.permissions & bit));
  if (holders.length) set("roles", true, holders.map((r) => r.id));
  if (!locked && !on && ((member.permission_allow ?? 0) & bit)) set("teamAllow", true);
  if (on && (teamDeny & bit)) set("teamDeny", false);

  const teamMask = effectivePermissions(member, roles, locked);
  if (teamMask & PERM_BITS.ADMINISTRATOR) {
    if (!on && !(teamDeny & bit)) set("administrator", true);
    return done();
  }
  if (on && (bit & SECRET_BITS) && !(teamMask & PERM_BITS.CONNECT)) set("needsConnect", false);

  if (layers === "notShown") {
    steps.push({ kind: "ruleNotShown", effect: "remove" });
    return done();
  }
  if (!layers) return done();

  const roleIdsCarryingBit = (kind: StepKind) => {
    if (!entries || (kind !== "rolesDeny" && kind !== "rolesAllow")) return undefined;
    return entries
      .filter((e) => e.subject_type === "role" && member.role_ids.includes(e.subject_id ?? "")
        && ((kind === "rolesDeny" ? e.deny : e.allow) & bit))
      .map((e) => e.subject_id!);
  };
  const probe = bit | PERM_BITS.VIEW | PERM_BITS.CONNECT;
  const p = foldRuleLayers(teamMask & probe, layers, teamDeny, locked, (layer, before, after) => {
    if ((before ^ after) & bit) set(layer.kind, (after & bit) !== 0, roleIdsCarryingBit(layer.kind));
  });

  if (!(p & PERM_BITS.VIEW)) {
    if (on) set("noView", false);
  } else if (on && (bit & SECRET_BITS) && !(p & PERM_BITS.CONNECT)) {
    set("needsConnect", false);
  }
  return done();
}
