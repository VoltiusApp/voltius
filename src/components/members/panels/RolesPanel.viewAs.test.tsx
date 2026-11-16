import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import type { TeamMember, TeamRole } from "@/services/teamService";

const h = vi.hoisted(() => ({ mobile: false, capable: true, enter: vi.fn(), toast: vi.fn() }));
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
vi.mock("@/services/appToast", () => ({ appToast: h.toast }));
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
  h.toast.mockReset();
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

const buttons = () => screen.findAllByRole("button", { name: "members.viewAs.previewAsRole" }) as Promise<HTMLButtonElement[]>;

test("role_card_has_preview_as_role", async () => {
  render(<TeamRolesPanel teamId="t1" />);
  const [builtin, custom] = await buttons();
  expect(builtin.disabled).toBe(false);
  expect(builtin.title).toBe("members.viewAs.previewAsRole");
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

test("the_expanded_card_offers_the_labelled_button_with_the_same_entry", async () => {
  h.capable = false;
  render(<TeamRolesPanel teamId="t1" />);
  fireEvent.click(await screen.findByText("custom1"));
  const labelled = screen.getByText("members.viewAs.previewAsRole").closest("button")!;
  expect(labelled.disabled).toBe(true);
  expect(labelled.title).toBe("members.viewAs.reason.serverTooOld");
});

test("preview_as_role_renders_on_mobile", async () => {
  h.mobile = true;
  render(<TeamRolesPanel teamId="t1" />);
  const found = await buttons();
  expect(found.length).toBeGreaterThan(0);
  for (const b of found) expect(b.className).toContain("min-h-12 min-w-12");
});

test("greyed_mobile_preview_as_role_toasts_the_reason_without_entering", async () => {
  h.mobile = true;
  h.capable = false;
  render(<TeamRolesPanel teamId="t1" />);
  const [first] = await buttons();
  expect(first.getAttribute("aria-disabled")).toBe("true");
  fireEvent.click(first);
  expect(h.toast).toHaveBeenCalledWith("info", "members.viewAs.reason.serverTooOld");
  expect(h.enter).not.toHaveBeenCalled();
});
