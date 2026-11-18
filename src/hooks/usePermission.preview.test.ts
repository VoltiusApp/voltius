// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@/hooks/useMyUserId", () => ({ useMyUserId: () => "admin" }));

import { usePermissions, useOwnPermissions, usePermissionSubjectId } from "./usePermission";
import { PreviewContentScope } from "@/hooks/previewScope";
import { usePreviewStore } from "@/stores/previewStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore, type Vault } from "@/stores/vaultStore";
import { useTeamObjectAccessStore } from "@/stores/teamObjectAccessStore";
import { PERM_BITS } from "@/services/permissions";
import type { Preview, PreviewResponse } from "@/services/permissionPreview";
import { makeMember, makeRole, makeTeam } from "@/test/team";

const { VIEW, CONNECT, EDIT_CONNECTIONS } = PERM_BITS;
const session = { teamId: "t1", vaultId: "v1", subject: { type: "member" as const, user_id: "bob" } };
const preview = (team_bits: number, objects: Record<string, number> = {}): Preview => ({
  team_bits,
  objects: Object.fromEntries(Object.entries(objects).map(([id, mask]) => [id, { mask, rule_set_id: null }])),
  rule_sets: {},
  holds_vault_key_gate: true,
});
const response = (current: Preview): PreviewResponse => ({ locked: false, current, draft: null, affected: null });
const inScope = ({ children }: { children: ReactNode }) => createElement(PreviewContentScope, null, children);

beforeEach(() => {
  useTeamStore.setState({
    teams: [makeTeam("t1", { owner_id: "admin" })],
    membersByTeam: { t1: [makeMember("admin", ["all"]), makeMember("bob", ["all"])] },
    rolesByTeam: { t1: [makeRole("all", VIEW | CONNECT | EDIT_CONNECTIONS)] },
  });
  useVaultStore.setState({ vaults: [{ id: "v1", teamId: "t1" } as Vault] });
  useTeamObjectAccessStore.setState({
    byTeam: { t1: { c1: { type: "connection", ruleSetId: null, myPermissions: 0, parentId: null, deleted: false } } },
  });
  usePreviewStore.setState({ session, draft: null, resultDraft: null, result: response(preview(VIEW, { c1: VIEW | CONNECT })) });
});

test("inside_the_scope_resolves_as_the_subject", () => {
  const { result } = renderHook(() => ({ can: usePermissions(), id: usePermissionSubjectId() }), { wrapper: inScope });
  expect(result.current.can("EDIT_CONNECTIONS", "v1")).toBe(false);
  expect(result.current.can("VIEW", "v1")).toBe(true);
  expect(result.current.can("CONNECT", "v1", "c1")).toBe(true);
  expect(result.current.id).toBe("bob");
});

test("outside_the_scope_resolves_as_me", () => {
  const { result } = renderHook(() => ({ can: usePermissions(), id: usePermissionSubjectId() }));
  expect(result.current.can("EDIT_CONNECTIONS", "v1")).toBe(true);
  expect(result.current.id).toBe("admin");
});

test("useOwnPermissions_ignores_the_scope", () => {
  const { result } = renderHook(() => useOwnPermissions(), { wrapper: inScope });
  expect(result.current("EDIT_CONNECTIONS", "v1")).toBe(true);
});

test("content_denies_everything_until_the_first_result", () => {
  usePreviewStore.setState({ result: null });
  const inside = renderHook(() => usePermissions(), { wrapper: inScope });
  expect(inside.result.current("VIEW", "v1")).toBe(false);
  expect(inside.result.current("CONNECT", "v1", "c1")).toBe(false);
  expect(renderHook(() => usePermissions()).result.current("VIEW", "v1")).toBe(true);
});

test("a_newer_draft_does_not_mix_with_the_result_of_an_older_one", () => {
  const { result } = renderHook(() => usePermissions(), { wrapper: inScope });
  act(() => usePreviewStore.setState({ draft: { role_ids: [], allow: 0, deny: VIEW | CONNECT } }));
  expect(result.current("VIEW", "v1")).toBe(true);
  expect(result.current("EDIT_CONNECTIONS", "v1")).toBe(false);
  expect(result.current("CONNECT", "v1", "c1")).toBe(true);
});

test("outside_the_scope_does_not_rerender_on_preview_updates", () => {
  let renders = 0;
  renderHook(() => { renders++; return usePermissions(); });
  const before = renders;
  act(() => usePreviewStore.setState({ draft: { permissions: 1 }, resultDraft: { permissions: 1 }, result: response(preview(0)) }));
  expect(renders).toBe(before);
});
