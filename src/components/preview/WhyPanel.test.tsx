import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import type { PreviewResponse, RuleLayers } from "@/services/permissionPreview";
import { ALL_PERMISSION_BITS, PERM_BITS, type RuleEntry } from "@/services/permissions";

const h = vi.hoisted(() => ({
  can: { value: ((_p: string, _v: string, _o?: string) => true) as (p: string, v: string, o?: string) => boolean },
  sets: {} as Record<string, RuleEntry[]>,
  items: {} as Record<string, { id: string; name: string; host?: string; username?: string }>,
  putRuleSet: vi.fn(),
  saveItem: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o ? `${k}:${Object.values(o).join("|")}` : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/services/sync", () => ({ onTeamSseEvent: () => () => {} }));
vi.mock("@/hooks/useBusinessLock", () => ({ useBusinessLock: () => ({ locked: false, isOwner: true }) }));
vi.mock("@/hooks/usePermission", async (orig) => ({
  ...(await orig<typeof import("@/hooks/usePermission")>()),
  useOwnPermissions: () => (p: string, v: string, o?: string) => h.can.value(p, v, o),
}));
vi.mock("@/services/teamObjects", async (orig) => ({
  ...(await orig<typeof import("@/services/teamObjects")>()),
  getRuleSet: async (_team: string, setId: string) => ({ entries: h.sets[setId] ?? [], updatedAt: null }),
  putRuleSet: h.putRuleSet,
}));
vi.mock("@/services/teamObjectPersistence", async (orig) => ({
  ...(await orig<typeof import("@/services/teamObjectPersistence")>()),
  findTeamItem: async (_team: string, _type: string, id: string) => h.items[id],
  saveTeamVaultObject: h.saveItem,
}));

import { WhyPanel } from "./WhyPanel";
import { ViewAsSidePanel } from "./ViewAsSidePanel";
import { usePreviewStore } from "@/stores/previewStore";
import { useTeamStore } from "@/stores/teamStore";
import { useTeamObjectAccessStore, type ObjectAccess } from "@/stores/teamObjectAccessStore";
import { makeMember, makeRole, makeTeam } from "@/test/team";
import { PREVIEW_SESSION } from "@/test/preview";

const NONE: RuleLayers = { everyone_allow: 0, everyone_deny: 0, roles_allow: 0, roles_deny: 0, member_allow: 0, member_deny: 0 };
const MEMBER_BITS = PERM_BITS.VIEW | PERM_BITS.CONNECT;

const access = (over: Partial<ObjectAccess>): ObjectAccess => ({
  type: "connection", ruleSetId: null, myPermissions: ALL_PERMISSION_BITS, parentId: null, deleted: false, ...over,
});

function preview(mask: number, ruleSetId: string | null, ruleSets: Record<string, RuleLayers> = {}): PreviewResponse {
  return {
    locked: false,
    current: { team_bits: MEMBER_BITS, objects: { c1: { mask, rule_set_id: ruleSetId } }, rule_sets: ruleSets, holds_vault_key_gate: true },
    draft: null,
    affected: null,
  };
}

const show = (result: PreviewResponse) =>
  usePreviewStore.setState({ session: PREVIEW_SESSION, result, resultDraft: null, draft: null, side: { kind: "why", type: "connection", objectId: "c1" } });

const row = (permission: string) => screen.getByTestId(`why-row-${permission}`);

beforeEach(() => {
  h.can.value = () => true;
  h.sets = {};
  h.items = { c1: { id: "c1", name: "db-prod", host: "10.0.0.5", username: "root" }, fA: { id: "fA", name: "Databases" } };
  h.putRuleSet.mockReset().mockResolvedValue(undefined);
  h.saveItem.mockReset().mockResolvedValue(undefined);
  useTeamStore.setState({
    teams: [makeTeam("team-1")],
    rolesByTeam: { "team-1": [makeRole("r-mem", MEMBER_BITS, { name: "member", is_builtin: true }), makeRole("r-con", PERM_BITS.VIEW, { name: "Contractor" })] },
    membersByTeam: { "team-1": [makeMember("bob", ["r-mem", "r-con"], { member_name: "Bob" })] },
  });
  useTeamObjectAccessStore.getState().replaceTeam("team-1", {
    fA: access({ type: "folder", ruleSetId: "sA" }),
    c1: access({ ruleSetId: "sA", parentId: "fA" }),
  }, true);
});

afterEach(() => {
  cleanup();
  usePreviewStore.setState({ session: null, result: null, side: null });
  useTeamObjectAccessStore.getState().clearAll();
});

test("rows_follow_the_server_mask_even_if_the_explanation_disagrees", async () => {
  show(preview(PERM_BITS.VIEW, null));
  render(<WhyPanel />);
  expect(await screen.findByText("db-prod")).toBeTruthy();
  expect(row("VIEW").getAttribute("data-allowed")).toBe("true");
  expect(row("CONNECT").getAttribute("data-allowed")).toBe("false");
  expect(within(row("CONNECT")).getByText("members.viewAs.why.decidedByServer")).toBeTruthy();
  expect(within(row("VIEW")).getByText(/members\.viewAs\.why\.step\.roles:.*member/)).toBeTruthy();
});

test("names_role_and_folder_for_a_role_deny_on_a_folder", async () => {
  h.sets.sA = [{ subject_type: "role", subject_id: "r-con", allow: 0, deny: PERM_BITS.VIEW }];
  show(preview(0, "sA", { sA: { ...NONE, roles_deny: PERM_BITS.VIEW } }));
  render(<WhyPanel />);
  await waitFor(() => expect(within(row("VIEW")).getByText(/members\.viewAs\.why\.step\.rolesDeny:.*Contractor.*Databases/)).toBeTruthy());
  expect(row("VIEW").getAttribute("data-allowed")).toBe("false");
  expect(within(row("CONNECT")).getByText(/members\.viewAs\.why\.step\.noView/)).toBeTruthy();
  expect(screen.getByText(/members\.viewAs\.why\.order/)).toBeTruthy();
  const steps = within(screen.getByTestId("why-steps"));
  expect(steps.getAllByText(/members\.viewAs\.why\.step\.rolesDeny/)).toHaveLength(1);
  expect(steps.getAllByText(/members\.viewAs\.why\.step\.noView/)).toHaveLength(1);
  const lines = steps.getAllByRole("listitem").map((li) => li.textContent ?? "");
  expect(lines.findIndex((l) => l.includes("step.roles:"))).toBeLessThan(lines.findIndex((l) => l.includes("step.rolesDeny")));
  expect(lines.findIndex((l) => l.includes("step.rolesDeny"))).toBeLessThan(lines.findIndex((l) => l.includes("step.noView")));
});

test("rule_set_not_shown_uses_the_generic_sentence", async () => {
  show(preview(0, "sHidden"));
  render(<WhyPanel />);
  expect(await screen.findByText("db-prod")).toBeTruthy();
  expect(within(row("VIEW")).getByText(/members\.viewAs\.why\.step\.ruleNotShown/)).toBeTruthy();
  expect(row("VIEW").getAttribute("data-allowed")).toBe("false");
});

test("edit_rules_is_greyed_without_manage_roles", async () => {
  h.can.value = (p, _v, o) => !(p === "MANAGE_ROLES" && o === "fA");
  show(preview(PERM_BITS.VIEW, "sA", { sA: NONE }));
  render(<WhyPanel />);
  const edit = await screen.findByRole("button", { name: /members\.viewAs\.why\.editRules:Databases/ }) as HTMLButtonElement;
  expect(edit.disabled).toBe(true);
  expect(edit.title).toMatch(/members\.viewAs\.why\.editRulesLocked/);
  expect(screen.getByText(/members\.viewAs\.why\.editRulesLocked/)).toBeTruthy();
  fireEvent.click(edit);
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("edit_access_returns_to_the_access_panel", async () => {
  show(preview(PERM_BITS.VIEW, null));
  render(<WhyPanel />);
  fireEvent.click(await screen.findByRole("button", { name: /members\.viewAs\.why\.editAccess/ }));
  expect(usePreviewStore.getState().side).toEqual({ kind: "access" });
});

test("rules_modal_edits_the_owner_folder_with_the_admins_own_permissions", async () => {
  show(preview(PERM_BITS.VIEW, "sA", { sA: NONE }));
  render(<ViewAsSidePanel />);
  fireEvent.click(await screen.findByRole("button", { name: /members\.viewAs\.why\.editRules:Databases/ }));
  const dialog = await screen.findByRole("dialog");
  expect(await within(dialog).findByRole("radiogroup", { name: /members\.permission\.EDIT_FOLDERS/ })).toBeTruthy();
});

test("a_rule_edit_from_the_modal_is_not_refused_while_previewing", async () => {
  show(preview(PERM_BITS.VIEW, "sA", { sA: NONE }));
  render(<WhyPanel />);
  fireEvent.click(await screen.findByRole("button", { name: /members\.viewAs\.why\.editRules:Databases/ }));
  const dialog = await screen.findByRole("dialog");
  const connect = await within(dialog).findByRole("radiogroup", { name: /members\.permission\.CONNECT/ });
  fireEvent.click(within(connect).getByRole("radio", { name: "members.permissions.state.deny" }));
  await waitFor(() => expect(h.putRuleSet).toHaveBeenCalledWith("team-1", "sA", [
    { subject_type: "everyone", subject_id: null, allow: 0, deny: PERM_BITS.CONNECT },
  ], null));
  expect(within(dialog).queryByText("Read-only preview")).toBeNull();
});

test("sync_now_from_the_modal_is_not_refused_while_previewing", async () => {
  useTeamObjectAccessStore.getState().upsert("team-1", "c1", access({ ruleSetId: "sOwn", parentId: "fA" }));
  show(preview(PERM_BITS.VIEW, "sOwn", { sOwn: NONE }));
  render(<WhyPanel />);
  fireEvent.click(await screen.findByRole("button", { name: /members\.viewAs\.why\.editRules:db-prod/ }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(await within(dialog).findByText("shared.permissions.section.syncNow"));
  await waitFor(() => expect(h.saveItem).toHaveBeenCalledWith("team-1", "connection", h.items.c1, { ruleSetId: "sA" }));
});
