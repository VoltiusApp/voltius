// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { MembersModel } from "@/components/members/useMembersModel";
import type { PendingInvitation } from "@/services/teamService";
import { makeMember, makeRole } from "@/test/team";

const h = vi.hoisted(() => ({
  model: null as unknown as MembersModel,
  revoke: vi.fn(),
  invite: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/members/useMembersModel", async (orig) => ({
  ...(await orig<typeof import("@/components/members/useMembersModel")>()),
  useMembersModel: () => h.model,
}));
vi.mock("@/services/account", () => ({ getMyHandle: async () => "merry-quartz-2597" }));
vi.mock("@/services/vaultShare", () => ({ revokeInvitation: h.revoke, inviteByEmailAddress: h.invite }));
vi.mock("@/components/members/cards/JoinRequests", () => ({ JoinRequestsSection: () => <div data-test-join-requests /> }));
vi.mock("@/components/members/OffboardingDialog", () => ({
  OffboardingDialog: ({ members }: { members: { user_id: string }[] }) => <div data-test-offboarding={members.map((m) => m.user_id).join(",")} />,
}));
vi.mock("@/components/members/panels/MembersCTA", () => ({
  SignInToCloudCTA: () => <div data-test-sign-in-cta />,
  UpgradeToTeamsCTA: () => <div data-test-upgrade-cta />,
}));

import MobileMembersScreen from "./MobileMembersScreen";
import { useMobileNavStore } from "@/stores/mobileNavStore";
import { useBackStackStore } from "@/hooks/useBackInterceptor";
import { useNotificationStore } from "@/stores/notificationStore";
import { useSubscriptionStore } from "@/stores/subscriptionStore";

const ME = makeMember("me", ["r-admin"], { handle: "me-h" });
const ANA = makeMember("ana", ["r-member"], { handle: "ana-h" });
const BOSS = makeMember("boss", ["r-owner"], { handle: "boss-h" });
const MEMBER = makeRole("r-member", 0, { name: "member", is_builtin: true });
const EDITOR = makeRole("r-editor", 0, { name: "editor", is_builtin: true, position: 0 });
const INV: PendingInvitation = {
  id: "inv1", display_name: "jade@example.com", role: "member", invited_by_display_name: null,
  created_at: "2024-01-01", expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(), status: "pending",
};

function makeModel(over: Partial<MembersModel> = {}): MembersModel {
  const members = [ME, ANA, BOSS];
  return {
    teamId: "t1", localVault: undefined, standaloneTeam: undefined,
    members, roles: [MEMBER, EDITOR], pending: [INV], loading: false,
    myUserId: "me", myMember: ME,
    canManageMembers: true, canManageRoles: true, canInvite: true, canManageVault: true, canNameMembers: true,
    isOwnerMember: (m) => m.user_id === "boss",
    outOfReach: (m) => m.user_id === "boss",
    canActOn: (m) => m.user_id === "ana",
    canEditMember: (m) => m.user_id === "ana",
    visible: () => members,
    roleOptions: () => [EDITOR, MEMBER],
    changeRole: vi.fn(async () => {}),
    reload: vi.fn(async () => {}),
    ...over,
  };
}

const ROOT = { kind: "more-page" as const, page: "members" as const };
const q = (c: HTMLElement, sel: string) => c.querySelector<HTMLElement>(sel);
const rowButton = (c: HTMLElement, id: string) => q(c, `[data-mobile-member='${id}'] button`)!;
const toastMessages = () => useNotificationStore.getState().toasts.map((x) => x.message);

beforeEach(() => {
  h.model = makeModel();
  h.revoke.mockReset().mockResolvedValue(undefined);
  h.invite.mockReset().mockResolvedValue(undefined);
  useMobileNavStore.setState({ stack: [ROOT], sheet: null });
  useNotificationStore.setState({ toasts: [] });
});
afterEach(cleanup);

describe("MobileMembersScreen", () => {
  test("renders_you_members_and_pending_sections", () => {
    const { container } = render(<MobileMembersScreen vaultId="t1" />);
    const ids = (section: string) =>
      [...container.querySelectorAll(`[data-members-section='${section}'] [data-mobile-member]`)].map((e) => e.getAttribute("data-mobile-member"));
    expect(ids("you")).toEqual(["me"]);
    expect(ids("members")).toEqual(["ana", "boss"]);
    expect(q(container, "[data-members-section='pending'] [data-mobile-invite='inv1']")).not.toBeNull();
    expect(q(container, "[data-vt-hit-scope] [data-test-join-requests]")).not.toBeNull();
    expect(q(container, "[data-mobile-member='me']")!.textContent).toContain("members.youBadge");
  });

  test("tap_pushes_the_member_screen", () => {
    const { container } = render(<MobileMembersScreen vaultId="t1" />);
    fireEvent.click(rowButton(container, "ana"));
    expect(useMobileNavStore.getState().stack.slice(-1)[0]).toEqual({ kind: "member", teamId: "t1", userId: "ana" });
  });

  test("long_press_enters_selection_and_assign_role_calls_change_role", () => {
    const { container } = render(<MobileMembersScreen vaultId="t1" />);
    fireEvent.contextMenu(rowButton(container, "ana"));
    expect(q(container, "[data-members-selection-bar]")).not.toBeNull();
    expect(q(container, "[data-members-invite]")).toBeNull();

    fireEvent.click(q(container, "[data-members-sel-assign]")!);
    fireEvent.click(document.querySelector("[data-role-pick='r-editor']")!);

    expect(h.model.changeRole).toHaveBeenCalledWith([ANA], EDITOR, "assign", { bulk: true });
    expect(q(container, "[data-members-selection-bar]")).toBeNull();
    expect(document.querySelector("[data-role-pick]")).toBeNull();
  });

  test("kick opens the offboarding dialog for the selection", () => {
    const { container } = render(<MobileMembersScreen vaultId="t1" />);
    fireEvent.contextMenu(rowButton(container, "ana"));
    fireEvent.click(q(container, "[data-members-sel-kick]")!);
    expect(q(container, "[data-test-offboarding='ana']")).not.toBeNull();
  });

  test("bar actions are greyed with the lack reason without manage members", () => {
    h.model = makeModel({ canActOn: () => true, canManageMembers: false });
    const { container } = render(<MobileMembersScreen vaultId="t1" />);
    fireEvent.contextMenu(rowButton(container, "ana"));
    for (const a of ["assign", "remove", "kick"]) {
      const btn = q(container, `[data-members-sel-${a}]`)!;
      expect(btn.getAttribute("aria-disabled")).toBe("true");
      expect(btn.title).toBe("members.permissions.youLack");
      fireEvent.click(btn);
    }
    expect(document.querySelector("[data-role-pick]")).toBeNull();
    expect(q(container, "[data-test-offboarding]")).toBeNull();
    expect(toastMessages()).toEqual(Array(3).fill("members.permissions.youLack"));
  });

  test("long_press_on_an_out_of_reach_member_shows_the_reason_and_selects_nothing", () => {
    const { container } = render(<MobileMembersScreen vaultId="t1" />);
    fireEvent.contextMenu(rowButton(container, "boss"));
    expect(q(container, "[data-members-selection-bar]")).toBeNull();
    expect(toastMessages()).toEqual(["mobile.members.selectOwner"]);

    fireEvent.contextMenu(rowButton(container, "me"));
    expect(q(container, "[data-members-selection-bar]")).toBeNull();
    expect(toastMessages()).toContain("mobile.members.selectSelf");

    fireEvent.contextMenu(rowButton(container, "ana"));
    expect(q(container, "[data-members-selection-bar]")).not.toBeNull();
    expect(q(container, "[data-mobile-member='boss']")!.textContent).toContain("mobile.members.selectOwner");
    fireEvent.click(rowButton(container, "boss"));
    expect(q(container, "[data-mobile-member='boss'] [role=checkbox]")!.getAttribute("aria-checked")).toBe("false");
    expect(q(container, "[data-mobile-member='ana'] [role=checkbox]")!.getAttribute("aria-checked")).toBe("true");
    expect(useMobileNavStore.getState().stack).toEqual([ROOT]);
  });

  test("back_clears_the_selection_before_leaving", () => {
    const { container } = render(<MobileMembersScreen vaultId="t1" />);
    fireEvent.contextMenu(rowButton(container, "ana"));
    const interceptors = useBackStackStore.getState().stack;
    expect(interceptors).toHaveLength(1);
    act(() => interceptors[0].close());
    expect(q(container, "[data-members-selection-bar]")).toBeNull();
    expect(useMobileNavStore.getState().stack).toEqual([ROOT]);
  });

  test("selection is pruned when members reload", () => {
    const { container, rerender } = render(<MobileMembersScreen vaultId="t1" />);
    fireEvent.contextMenu(rowButton(container, "ana"));
    h.model = makeModel({ members: [ME, BOSS], visible: () => [ME, BOSS] });
    rerender(<MobileMembersScreen vaultId="t1" />);
    expect(q(container, "[data-members-selection-bar]")).toBeNull();
  });

  test("invite_fab_greyed_without_invite_permission", () => {
    h.model = makeModel({ canInvite: false });
    const { container, unmount } = render(<MobileMembersScreen vaultId="t1" />);
    const fab = q(container, "[data-members-invite]")!;
    expect(fab.getAttribute("aria-disabled")).toBe("true");
    expect(fab.title).toBe("members.permissions.youLack");
    fireEvent.click(fab);
    expect(useMobileNavStore.getState().stack).toEqual([ROOT]);
    expect(toastMessages()).toEqual(["members.permissions.youLack"]);
    unmount();

    h.model = makeModel();
    const view = render(<MobileMembersScreen vaultId="t1" />);
    fireEvent.click(q(view.container, "[data-members-invite]")!);
    expect(useMobileNavStore.getState().stack.slice(-1)[0]).toEqual({ kind: "vault-settings", vaultId: "t1", page: "share" });
  });

  test("security_row_greyed_without_manage_vault", () => {
    h.model = makeModel({ canManageVault: false });
    const { container } = render(<MobileMembersScreen vaultId="t1" />);
    const security = q(container, "[data-members-nav='security']")!;
    expect(security.querySelector("button")!.getAttribute("aria-disabled")).toBe("true");
    expect(security.textContent).toContain("members.permissions.youLack");
    fireEvent.click(security.querySelector("button")!);
    expect(useMobileNavStore.getState().stack).toEqual([ROOT]);

    fireEvent.click(q(container, "[data-members-nav='roles'] button")!);
    expect(useMobileNavStore.getState().stack.slice(-1)[0]).toEqual({ kind: "vault-settings", vaultId: "t1", page: "roles" });
  });

  test("private_vault_shows_the_self_card_or_cta", async () => {
    const privateModel = { teamId: null, localVault: { id: "v1", name: "Mine" } as MembersModel["localVault"], members: [], pending: [], visible: () => [] };
    h.model = makeModel(privateModel);
    useSubscriptionStore.setState({ accountMode: "local", ownsTeamsPlan: false });
    const { container, unmount } = render(<MobileMembersScreen vaultId="v1" />);
    expect(q(container, "[data-test-sign-in-cta]")).not.toBeNull();
    unmount();

    useSubscriptionStore.setState({ accountMode: "server", ownsTeamsPlan: true });
    render(<MobileMembersScreen vaultId="v1" />);
    expect(await screen.findByText("merry-quartz-2597")).toBeTruthy();
  });

  test("no vault and a stale vault id show the empty states", () => {
    h.model = makeModel({ teamId: null, members: [], pending: [], visible: () => [] });
    const { unmount } = render(<MobileMembersScreen vaultId={null} />);
    expect(screen.getByText("members.empty.noVaultTitle")).toBeTruthy();
    unmount();
    render(<MobileMembersScreen vaultId="gone" />);
    expect(screen.getByText("members.empty.vaultNotFound")).toBeTruthy();
  });

  test("pending_row_opens_resend_and_revoke", async () => {
    const { container } = render(<MobileMembersScreen vaultId="t1" />);
    fireEvent.click(q(container, "[data-mobile-invite='inv1'] button")!);
    expect(document.querySelector("[data-invite-action='resend']")).not.toBeNull();
    fireEvent.click(document.querySelector("[data-invite-action='revoke']")!);
    expect(h.revoke).toHaveBeenCalledWith({ teamId: "t1", invitationId: "inv1", name: "jade@example.com" });
    await waitFor(() => expect(h.model.reload).toHaveBeenCalled());
    expect(document.querySelector("[data-invite-action]")).toBeNull();
  });
});
