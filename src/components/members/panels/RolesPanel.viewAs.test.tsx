import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { TeamMember, TeamRole } from "@/services/teamService";

const h = vi.hoisted(() => ({ mobile: false, capable: true, enter: vi.fn() }));
const api = vi.hoisted(() => ({
  listRoles: vi.fn(async () => [] as TeamRole[]),
  listMembers: vi.fn(async () => [] as TeamMember[]),
  getMyUserId: vi.fn(async () => "me"),
}));
vi.mock("@/services/teamService", () => api);
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: ({ icon }: { icon: string }) => <i data-icon={icon} /> }));
vi.mock("@/components/theme-creator/ColorPicker", () => ({ ColorPicker: () => null }));
vi.mock("@/utils/platform", async (orig) => ({ ...(await orig<typeof import("@/utils/platform")>()), isMobileShell: () => h.mobile }));
vi.mock("@/services/serverCapabilities", async (orig) => ({
  ...(await orig<typeof import("@/services/serverCapabilities")>()),
  useServerPermissionPreview: () => h.capable,
}));

import { TeamRolesPanel } from "@/components/members/panels/RolesPanel";
import { PERM_BITS } from "@/hooks/usePermission";
import { useTeamStore } from "@/stores/teamStore";
import { useVaultStore } from "@/stores/vaultStore";
import { usePreviewStore } from "@/stores/previewStore";
import { makeMember, makeRole } from "@/test/team";

const originalEnter = usePreviewStore.getState().enter;

beforeEach(() => {
  localStorage.clear();
  h.mobile = false;
  h.capable = true;
  h.enter.mockReset();
  api.getMyUserId.mockResolvedValue("me");
  api.listRoles.mockResolvedValue([
    makeRole("mgr", PERM_BITS.MANAGE_ROLES, { is_builtin: true, position: 0 }),
    makeRole("custom1", 0),
  ]);
  api.listMembers.mockResolvedValue([makeMember("me", ["mgr"])]);
  useTeamStore.setState({
    teams: [{ id: "t1", name: "t1", owner_id: "o", owner_tier: "business", created_at: "", role_ids: [] }],
    membersByTeam: {}, rolesByTeam: {}, pendingInvitationsByTeam: {}, myPendingInvitations: [], activeTeamId: null, loading: false,
  });
  useVaultStore.setState({ vaults: [{ id: "v1", teamId: "t1" }] } as never);
  usePreviewStore.setState({ enter: h.enter });
});
afterEach(() => {
  cleanup();
  usePreviewStore.setState({ enter: originalEnter });
});

const buttons = () => screen.findAllByText("members.viewAs.previewAsRole").then((els) => els.map((el) => el.closest("button")!));

test("role_card_has_preview_as_role", async () => {
  render(<TeamRolesPanel teamId="t1" />);
  const [builtin, custom] = await buttons();
  expect(builtin.disabled).toBe(false);
  fireEvent.click(custom);
  expect(h.enter).toHaveBeenCalledWith({ teamId: "t1", vaultId: "v1", subject: { type: "role", role_id: "custom1" } });
  fireEvent.click(builtin);
  expect(h.enter).toHaveBeenLastCalledWith({ teamId: "t1", vaultId: "v1", subject: { type: "role", role_id: "mgr" } });
});

test("role_cards_grey_out_with_the_reason_when_the_server_lacks_preview", async () => {
  h.capable = false;
  render(<TeamRolesPanel teamId="t1" />);
  for (const button of await buttons()) {
    expect(button.disabled).toBe(true);
    expect(button.title).toBe("members.viewAs.reason.serverTooOld");
  }
});

test("no_preview_as_role_on_the_mobile_shell", async () => {
  h.mobile = true;
  render(<TeamRolesPanel teamId="t1" />);
  await screen.findByText("custom1");
  await waitFor(() => expect(screen.queryByText("members.viewAs.previewAsRole")).toBeNull());
});
