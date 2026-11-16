// @vitest-environment jsdom
import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import { PERM_BITS } from "@/services/permissions";
import { makeMember, makeRole, makeTeam } from "@/test/team";
import { startPreview, stopPreview } from "@/test/preview";

const h = vi.hoisted(() => ({ getMyUserId: vi.fn(async () => "me" as string | null), enter: vi.fn(), capable: true }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@/services/serverCapabilities", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  useServerPermissionPreview: () => h.capable,
}));
vi.mock("@/services/teamService", async (io) => ({ ...(await io<Record<string, unknown>>()), getMyUserId: h.getMyUserId }));

import { useViewAsEntry } from "./useViewAsEntry";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { usePreviewStore } from "@/stores/previewStore";
import type { PreviewSubject } from "@/services/permissionPreview";

const MEMBER: PreviewSubject = { type: "member", user_id: "bob" };
const ROLE: PreviewSubject = { type: "role", role_id: "r1" };

function setup(opts: { bits?: number; tier?: string; capable?: boolean } = {}) {
  const { bits = PERM_BITS.MANAGE_MEMBERS | PERM_BITS.MANAGE_ROLES, tier = "business", capable = true } = opts;
  useTeamStore.setState({
    teams: [makeTeam("t1", { owner_tier: tier })],
    membersByTeam: { t1: [makeMember("me", ["admin"]), makeMember("bob", [])] },
    rolesByTeam: { t1: [makeRole("admin", bits, { is_builtin: true })] },
    loadTeams: vi.fn(async () => undefined),
    loadMembers: vi.fn(async () => undefined),
    loadRoles: vi.fn(async () => undefined),
  } as never);
  useVaultStore.setState({ vaults: [{ id: "v1", teamId: "t1" }] } as never);
  h.capable = capable;
}

const run = async (subject: PreviewSubject, expected: string | null) => {
  const { result } = renderHook(() => useViewAsEntry("t1", subject));
  await waitFor(() => expect(result.current.reason).toBe(expected));
  expect(result.current.enabled).toBe(expected === null);
  return result;
};

beforeEach(() => {
  h.getMyUserId.mockResolvedValue("me");
  usePreviewStore.setState({ enter: h.enter } as never);
  h.enter.mockReset();
});
afterEach(() => { cleanup(); stopPreview(); });

test("enabled_when_nothing_blocks", async () => {
  setup();
  await run(MEMBER, null);
});

test.each([
  ["needsManage", MEMBER, { bits: PERM_BITS.MANAGE_ROLES }],
  ["needsManage", ROLE, { bits: PERM_BITS.MANAGE_MEMBERS }],
  ["needsBusiness", MEMBER, { tier: "free" }],
  ["serverTooOld", MEMBER, { capable: false }],
] as const)("reason_%s_for_%s", async (reason, subject, opts) => {
  setup(opts);
  await run(subject, reason);
});

test("self_reason_when_the_subject_is_me", async () => {
  setup();
  await run({ type: "member", user_id: "me" }, "self");
});

test("previewing_reason_while_a_preview_is_active", async () => {
  setup();
  startPreview();
  await run(MEMBER, "previewing");
});

test("entry_points_grey_out_when_the_server_lacks_preview", async () => {
  setup({ capable: false });
  const result = await run(MEMBER, "serverTooOld");
  expect(result.current.reasonText).toBe("members.viewAs.reason.serverTooOld");
});

test("enter_selects_the_team_vault_and_starts_the_session", async () => {
  setup();
  const result = await run(MEMBER, null);
  result.current.enter();
  expect(h.enter).toHaveBeenCalledWith({ teamId: "t1", vaultId: "v1", subject: MEMBER });
});

test("a_team_with_no_local_vault_row_enters_on_the_team_id", async () => {
  setup();
  useVaultStore.setState({ vaults: [] } as never);
  const result = await run(MEMBER, null);
  result.current.button.onClick();
  expect(h.enter).toHaveBeenCalledWith({ teamId: "t1", vaultId: "t1", subject: MEMBER });
});

test("button_props_carry_the_reason_when_disabled", async () => {
  setup({ capable: false });
  const result = await run(MEMBER, "serverTooOld");
  expect(result.current.button.disabled).toBe(true);
  expect(result.current.button.title).toBe("members.viewAs.reason.serverTooOld");
});

test("enter_does_nothing_when_disabled", async () => {
  setup({ capable: false });
  const result = await run(MEMBER, "serverTooOld");
  result.current.enter();
  expect(h.enter).not.toHaveBeenCalled();
});
