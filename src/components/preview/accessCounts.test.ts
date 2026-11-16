import { expect, test } from "vitest";
import { PERM_BITS } from "@/services/permissions";
import type { Preview } from "@/services/permissionPreview";
import type { TeamAccessEntries } from "@/stores/teamObjectAccessStore";
import { countAccess } from "./accessCounts";

const entry = (type: TeamAccessEntries[string]["type"], deleted = false) =>
  ({ type, ruleSetId: null, myPermissions: 0, parentId: null, deleted });
const preview = (masks: Record<string, number>): Preview => ({
  team_bits: 0, rule_sets: {}, holds_vault_key_gate: true,
  objects: Object.fromEntries(Object.entries(masks).map(([id, mask]) => [id, { mask, rule_set_id: null }])),
});
const V = PERM_BITS.VIEW;

test("counts_visible_and_hidden_hosts_snippets_and_keys_only", () => {
  const entries: TeamAccessEntries = {
    h1: entry("connection"), h2: entry("connection"), h3: entry("connection"),
    s1: entry("snippet"), k1: entry("key"), i1: entry("identity"), f1: entry("folder"), p1: entry("port_forwarding_rule"),
  };
  const current = preview({ h1: V, h2: 0, h3: V | PERM_BITS.CONNECT, s1: V, k1: V, i1: 0, f1: V });
  expect(countAccess(entries, current)).toEqual({ hosts: 2, snippets: 1, keys: 1, hidden: 2 });
});

test("deleted_objects_are_ignored", () => {
  expect(countAccess({ h1: entry("connection", true) }, preview({ h1: V }))).toEqual({ hosts: 0, snippets: 0, keys: 0, hidden: 0 });
});

test("an_object_missing_from_the_preview_is_hidden", () => {
  expect(countAccess({ h1: entry("connection") }, preview({}))).toEqual({ hosts: 0, snippets: 0, keys: 0, hidden: 1 });
});

test("a_member_without_the_vault_key_sees_nothing", () => {
  const entries: TeamAccessEntries = { h1: entry("connection"), k1: entry("key") };
  expect(countAccess(entries, { ...preview({ h1: V, k1: V }), holds_vault_key_gate: false }))
    .toEqual({ hosts: 0, snippets: 0, keys: 0, hidden: 2 });
});
