// @vitest-environment jsdom
import { test, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/hooks/useMyUserId", () => ({ useMyUserId: () => "admin" }));
vi.mock("@/services/sync", () => ({ onTeamSseEvent: () => () => {} }));
vi.mock("@/services/teamKeyRotation", () => ({ checkAndRotateTeamKey: vi.fn() }));

import { usePermissions, useOwnPermissions, usePermissionSubjectId } from "./usePermission";
import { PreviewContentScope } from "@/components/preview/PreviewScope";
import { usePreviewStore } from "@/stores/previewStore";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore, type Vault } from "@/stores/vaultStore";
import { useTeamObjectAccessStore } from "@/stores/teamObjectAccessStore";
import { PERM_BITS } from "@/services/permissions";
import type { Team, TeamMember, TeamRole } from "@/services/teamService";

const role = (id: string, permissions: number): TeamRole =>
  ({ id, team_id: "t1", name: id, permissions, is_builtin: false, position: 1, created_at: "" });
const member = (user_id: string, role_ids: string[]): TeamMember =>
  ({ team_id: "t1", user_id, invited_by_display_name: null, joined_at: "", public_key: "", role_ids });
const session = { teamId: "t1", vaultId: "v1", subject: { type: "member" as const, user_id: "bob" } };
const inScope = ({ children }: { children: ReactNode }) => createElement(PreviewContentScope, null, children);

beforeEach(() => {
  useTeamStore.setState({
    teams: [{ id: "t1", owner_id: "admin", owner_tier: "business" } as Team],
    membersByTeam: { t1: [member("admin", ["all"]), member("bob", ["viewer"])] },
    rolesByTeam: { t1: [role("all", PERM_BITS.VIEW | PERM_BITS.EDIT_CONNECTIONS), role("viewer", PERM_BITS.VIEW)] },
  });
  useVaultStore.setState({ vaults: [{ id: "v1", teamId: "t1" } as Vault] });
  useTeamObjectAccessStore.setState({ byTeam: {} });
  usePreviewStore.setState({
    session,
    draft: null,
    result: { locked: false, current: { team_bits: 0, objects: {}, rule_sets: {}, holds_vault_key_gate: true }, draft: null, affected: null },
  });
});

test("inside_the_scope_resolves_as_the_subject", () => {
  const { result } = renderHook(() => ({ can: usePermissions(), id: usePermissionSubjectId() }), { wrapper: inScope });
  expect(result.current.can("EDIT_CONNECTIONS", "v1")).toBe(false);
  expect(result.current.can("VIEW", "v1")).toBe(true);
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
