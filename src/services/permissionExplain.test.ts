import { describe, expect, it } from "vitest";
import { explainBit } from "./permissionExplain";
import { ALL_PERMISSION_BITS, maskFromLayers, PERM_BITS as B, type RuleEntry } from "./permissions";
import type { RuleLayers } from "./permissionPreview";
import type { TeamRole } from "./teamService";

const NONE: RuleLayers = {
  everyone_allow: 0, everyone_deny: 0, roles_allow: 0, roles_deny: 0, member_allow: 0, member_deny: 0,
};
const rules = (r: Partial<RuleLayers>): RuleLayers => ({ ...NONE, ...r });
const role = (id: string, permissions: number, is_builtin = true): TeamRole => ({
  id, team_id: "t", name: id, permissions, is_builtin, position: 0, created_at: "",
});
const MEMBER = B.VIEW | B.CONNECT | B.VIEW_SECRETS;
const ALL_BITS = Object.values(B);

function explain(
  bit: number, base: number, teamDeny: number, layers: RuleLayers | null, locked: boolean,
) {
  return explainBit(bit, {
    roles: [role("base", base)], member: { role_ids: ["base"], permission_deny: teamDeny }, layers, locked,
  });
}

const serverCases: { name: string; base: number; teamDeny: number; rules: RuleLayers | null; locked: boolean; expected: number }[] = [
  { name: "no_rule_set_returns_the_team_mask", base: MEMBER, teamDeny: 0, rules: null, locked: false, expected: MEMBER },
  { name: "a_rule_set_with_no_relevant_entries_keeps_the_team_mask", base: MEMBER, teamDeny: 0, rules: NONE, locked: false, expected: MEMBER },
  {
    name: "everyone_deny_removes_and_everyone_allow_adds", base: MEMBER, teamDeny: 0, locked: false,
    rules: rules({ everyone_deny: B.VIEW_SECRETS, everyone_allow: B.COPY_SECRETS }),
    expected: B.VIEW | B.CONNECT | B.COPY_SECRETS,
  },
  {
    name: "role_layer_overrides_everyone", base: MEMBER, teamDeny: 0, locked: false,
    rules: rules({ everyone_deny: B.CONNECT, roles_allow: B.CONNECT }), expected: MEMBER,
  },
  {
    name: "within_the_role_layer_allow_beats_deny", base: MEMBER, teamDeny: 0, locked: false,
    rules: rules({ roles_deny: B.CONNECT, roles_allow: B.CONNECT }), expected: MEMBER,
  },
  {
    name: "member_layer_overrides_roles", base: MEMBER, teamDeny: 0, locked: false,
    rules: rules({ roles_allow: B.EDIT_CONNECTIONS, member_deny: B.EDIT_CONNECTIONS }), expected: MEMBER,
  },
  {
    name: "team_deny_stays_absolute_over_a_member_allow", base: MEMBER & ~B.VIEW_SECRETS, teamDeny: B.VIEW_SECRETS, locked: false,
    rules: rules({ member_allow: B.VIEW_SECRETS }), expected: MEMBER & ~B.VIEW_SECRETS,
  },
  {
    name: "losing_view_zeroes_every_bit", base: MEMBER, teamDeny: 0, locked: false,
    rules: rules({ everyone_deny: B.VIEW }), expected: 0,
  },
  {
    name: "a_rule_can_grant_view_the_team_mask_lacks", base: B.CONNECT, teamDeny: 0, locked: false,
    rules: rules({ member_allow: B.VIEW }), expected: B.VIEW | B.CONNECT,
  },
  {
    name: "denying_connect_on_an_object_also_removes_its_secrets", base: MEMBER | B.COPY_SECRETS, teamDeny: 0, locked: false,
    rules: rules({ everyone_deny: B.CONNECT }), expected: B.VIEW,
  },
  {
    name: "secrets_without_connect_grant_nothing_on_the_team_mask", base: B.VIEW | B.VIEW_SECRETS | B.COPY_SECRETS, teamDeny: 0,
    rules: null, locked: false, expected: B.VIEW,
  },
  {
    name: "a_member_allow_of_secrets_needs_connect_too", base: MEMBER, teamDeny: 0, locked: false,
    rules: rules({ member_deny: B.CONNECT, member_allow: B.VIEW_SECRETS }), expected: B.VIEW,
  },
  {
    name: "administrator_ignores_every_rule", base: B.ADMINISTRATOR, teamDeny: 0, locked: false,
    rules: rules({ everyone_deny: ALL_PERMISSION_BITS, member_deny: ALL_PERMISSION_BITS }), expected: ALL_PERMISSION_BITS,
  },
  { name: "administrator_ignores_every_rule_without_rules", base: B.ADMINISTRATOR, teamDeny: 0, rules: null, locked: false, expected: ALL_PERMISSION_BITS },
  {
    name: "administrator_still_loses_a_team_denied_bit", base: B.ADMINISTRATOR, teamDeny: B.COPY_SECRETS, rules: null, locked: false,
    expected: ALL_PERMISSION_BITS & ~B.COPY_SECRETS,
  },
  {
    name: "locked_ignores_allow_layers", base: MEMBER, teamDeny: 0, locked: true,
    rules: rules({ everyone_deny: B.VIEW, member_allow: B.VIEW }), expected: 0,
  },
  {
    name: "locked_keeps_deny_only_rules_for_everyone_else", base: MEMBER, teamDeny: 0, locked: true,
    rules: rules({ member_deny: B.VIEW_SECRETS }), expected: MEMBER & ~B.VIEW_SECRETS,
  },
  {
    name: "locked_applies_a_role_deny", base: MEMBER, teamDeny: 0, locked: true,
    rules: rules({ roles_deny: B.VIEW }), expected: 0,
  },
  { name: "locked_without_rules_is_the_team_mask", base: MEMBER, teamDeny: 0, rules: null, locked: true, expected: MEMBER },
  {
    name: "locked_builtin_administrator_keeps_the_bypass", base: B.ADMINISTRATOR, teamDeny: 0, locked: true,
    rules: rules({ everyone_deny: B.VIEW }), expected: ALL_PERMISSION_BITS,
  },
];

describe("explainBit", () => {
  it.each(serverCases)("matches_server_object_permissions_cases: $name", (c) => {
    for (const bit of ALL_BITS) {
      expect(explain(bit, c.base, c.teamDeny, c.rules, c.locked).allowed, `bit ${bit}`).toBe((c.expected & bit) !== 0);
    }
  });

  it("matches_server_object_permissions_cases: administrator_satisfies_the_connect_dependency", () => {
    const base = B.ADMINISTRATOR | B.VIEW_SECRETS | B.COPY_SECRETS;
    expect(maskFromLayers(base, null, 0, false)).toBe(ALL_PERMISSION_BITS);
    expect(explain(B.VIEW_SECRETS, base, 0, null, false).allowed).toBe(true);
    expect(explain(B.COPY_SECRETS, base, 0, rules({ everyone_deny: B.CONNECT }), false).allowed).toBe(true);
  });

  it("secrets_held_without_connect_survive_a_rule_that_adds_connect", () => {
    const r = rules({ member_allow: B.CONNECT });
    const base = B.VIEW | B.VIEW_SECRETS;
    expect(maskFromLayers(base, r, 0, false)).toBe(B.VIEW | B.CONNECT | B.VIEW_SECRETS);
    expect(explain(B.VIEW_SECRETS, base, 0, r, false).allowed).toBe(true);
    expect(explain(B.VIEW_SECRETS, base, 0, null, false).decidedBy?.kind).toBe("needsConnect");
  });

  it("matches_server_object_permissions_cases: locked_is_never_wider_than_business", () => {
    const pool = [B.VIEW, B.CONNECT, B.VIEW_SECRETS, B.COPY_SECRETS, B.EDIT_CONNECTIONS];
    const masks = Array.from({ length: 1 << pool.length }, (_, i) => pool.reduce((a, v, b) => (i & (1 << b) ? a | v : a), 0));
    for (const teamDeny of [0, B.CONNECT | B.EDIT_CONNECTIONS]) {
      for (const base of masks) for (const allow of masks) for (const deny of masks) {
        const r = rules({
          everyone_allow: allow, everyone_deny: deny, roles_allow: deny, roles_deny: allow, member_allow: allow, member_deny: deny,
        });
        for (const bit of pool) {
          const result = (locked: boolean) => {
            const allowed = explain(bit, base, teamDeny, r, locked).allowed;
            const mask = maskFromLayers(base & ~teamDeny, r, teamDeny, locked);
            if (allowed !== ((mask & bit) !== 0)) throw new Error(`explain!=mask base=${base} allow=${allow} deny=${deny} td=${teamDeny} bit=${bit} locked=${locked}`);
            return allowed;
          };
          if (result(true) && !result(false)) throw new Error(`base=${base} allow=${allow} deny=${deny} bit=${bit}`);
        }
      }
    }
  });

  it("role_allow_undoes_everyone_deny", () => {
    const e = explain(B.CONNECT, MEMBER, 0, rules({ everyone_deny: B.CONNECT, roles_allow: B.CONNECT }), false);
    expect(e.allowed).toBe(true);
    expect(e.decidedBy?.kind).toBe("rolesAllow");
    expect(e.steps.map((s) => s.kind)).toEqual(["roles", "everyoneDeny", "rolesAllow"]);
  });

  it("team_deny_last_beats_member_allow", () => {
    const e = explain(B.EDIT_CONNECTIONS, B.VIEW | B.EDIT_CONNECTIONS, 0, rules({ member_allow: B.EDIT_CONNECTIONS }), false);
    expect(e.allowed).toBe(true);
    const denied = explainBit(B.EDIT_CONNECTIONS, {
      roles: [role("base", B.VIEW)], member: { role_ids: ["base"], permission_deny: B.EDIT_CONNECTIONS },
      layers: rules({ member_allow: B.EDIT_CONNECTIONS }), locked: false,
    });
    expect(denied.allowed).toBe(false);
    expect(denied.decidedBy).toEqual({ kind: "teamDenyLast", effect: "remove" });
  });

  it("locked_drops_custom_roles_and_rule_allows", () => {
    const input = {
      roles: [role("custom", B.VIEW | B.EDIT_KEYS, false), role("builtin", B.VIEW)],
      member: { role_ids: ["custom", "builtin"] }, layers: rules({ everyone_allow: B.EDIT_KEYS }),
    };
    expect(explainBit(B.EDIT_KEYS, { ...input, locked: false }).allowed).toBe(true);
    const locked = explainBit(B.EDIT_KEYS, { ...input, locked: true });
    expect(locked.allowed).toBe(false);
    expect(locked.decidedBy).toBeNull();
    expect(locked.steps).toEqual([]);
    const lockedView = explainBit(B.VIEW, { ...input, locked: true });
    expect(lockedView.steps[0]).toEqual({ kind: "roles", effect: "grant", roleIds: ["builtin"] });
  });

  it("administrator_skips_rules", () => {
    const e = explain(B.EDIT_KEYS, B.ADMINISTRATOR, 0, rules({ everyone_deny: B.EDIT_KEYS }), false);
    expect(e.allowed).toBe(true);
    expect(e.decidedBy?.kind).toBe("administrator");
    expect(e.steps.some((s) => s.kind === "everyoneDeny")).toBe(false);
  });

  it("secrets_need_connect", () => {
    const e = explain(B.VIEW_SECRETS, B.VIEW | B.VIEW_SECRETS, 0, null, false);
    expect(e.allowed).toBe(false);
    expect(e.decidedBy).toEqual({ kind: "needsConnect", effect: "remove" });
  });

  it("notShown_is_silent_when_the_bit_was_never_granted", () => {
    const e = explainBit(B.EDIT_KEYS, {
      roles: [role("dev", MEMBER)], member: { role_ids: ["dev"] }, layers: "notShown", locked: false,
    });
    expect(e.steps).toEqual([]);
    expect(e.decidedBy).toBeNull();
  });

  it("secrets_need_connect after rules strip Connect", () => {
    const e = explain(B.VIEW_SECRETS, MEMBER, 0, rules({ everyone_deny: B.CONNECT }), false);
    expect(e.allowed).toBe(false);
    expect(e.decidedBy?.kind).toBe("needsConnect");
  });

  it("no_view_zeroes_the_bit", () => {
    const e = explain(B.CONNECT, MEMBER, 0, rules({ everyone_deny: B.VIEW }), false);
    expect(e.allowed).toBe(false);
    expect(e.decidedBy?.kind).toBe("noView");
  });

  it("names_the_denying_role_from_entries", () => {
    const entries: RuleEntry[] = [
      { subject_type: "role", subject_id: "contractor", allow: 0, deny: B.CONNECT },
      { subject_type: "role", subject_id: "contractor", allow: 0, deny: B.CONNECT },
      { subject_type: "role", subject_id: "other", allow: 0, deny: B.CONNECT },
      { subject_type: "role", subject_id: "dev", allow: 0, deny: B.EDIT_KEYS },
    ];
    const e = explainBit(B.CONNECT, {
      roles: [role("dev", MEMBER), role("contractor", 0)],
      member: { role_ids: ["dev", "contractor"] }, layers: rules({ roles_deny: B.CONNECT | B.EDIT_KEYS }), locked: false, entries,
    });
    const step = e.steps.find((s) => s.kind === "rolesDeny");
    expect(step?.roleIds).toEqual(["contractor"]);
  });

  it("notShown_replaces_rule_layers_with_one_step", () => {
    const e = explainBit(B.CONNECT, {
      roles: [role("dev", MEMBER)], member: { role_ids: ["dev"] }, layers: "notShown", locked: false,
    });
    expect(e.steps.map((s) => s.kind)).toEqual(["roles", "ruleNotShown"]);
  });
});
