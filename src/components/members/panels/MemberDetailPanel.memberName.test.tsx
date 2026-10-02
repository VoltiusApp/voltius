import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { TeamMember, TeamRole } from "@/stores/teamStore";

const h = vi.hoisted(() => ({
  setMemberName: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/shared/Panel", () => ({
  PanelShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelHeader: ({ subtitle }: { subtitle?: React.ReactNode }) => <div>{subtitle}</div>,
  FormSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelHeaderIconButton: () => null,
}));
vi.mock("@/components/members/panels/RolesPanel", () => ({ RoleModal: () => null, TeamRolesPanel: () => null }));
vi.mock("@/stores/teamStore", () => {
  const state = { setMemberName: h.setMemberName, membersByTeam: {} };
  const useTeamStore = Object.assign(
    (sel: (s: typeof state) => unknown) => sel(state),
    { getState: () => state },
  );
  return { useTeamStore };
});
vi.mock("@/i18n", () => ({ default: { t: (k: string) => k } }));
vi.mock("@/stores/historyStore", () => ({
  useHistoryStore: Object.assign(
    (sel: (s: { push: () => void }) => unknown) => sel({ push: vi.fn() }),
    { getState: () => ({ push: vi.fn() }) },
  ),
}));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/services/teamKeyRotation", () => ({ checkAndRotateTeamKey: vi.fn() }));
vi.mock("@/hooks/useBusinessLock", () => ({ useBusinessLock: () => ({ locked: false, isOwner: true }) }));
vi.mock("@/services/billingCheckout", () => ({ openBillingCheckout: vi.fn() }));

import { MemberDetailPanel } from "./MemberDetailPanel";

const member: TeamMember = {
  team_id: "t",
  user_id: "u2",
  invited_by_display_name: null,
  joined_at: "2024-01-01T00:00:00Z",
  handle: "amber-lynx-4410",
  public_key: "pk",
  role_ids: [],
};
const teamRoles: TeamRole[] = [];

const onClose = vi.fn();
const onUpdated = vi.fn();

function renderPanel(o: { canNameMembers: boolean; member?: TeamMember }) {
  return render(
    <MemberDetailPanel
      member={o.member ?? member}
      isMe={false}
      teamId="t"
      teamRoles={teamRoles}
      canManageMembers
      canNameMembers={o.canNameMembers}
      isTargetOwner={false}
      onClose={onClose}
      onUpdated={onUpdated}
    />,
  );
}

beforeEach(() => {
  h.setMemberName.mockReset().mockResolvedValue(undefined);
  onClose.mockReset();
  onUpdated.mockReset();
});
afterEach(() => cleanup());

test("rename control hidden without permission", () => {
  renderPanel({ canNameMembers: false });
  expect(screen.queryByLabelText("members.detail.nameLabel")).toBeNull();
});

test("saving trims and stores; clearing sends null", async () => {
  renderPanel({ canNameMembers: true, member: { ...member, member_name: "Jan" } });
  const input = screen.getByLabelText("members.detail.nameLabel");
  fireEvent.change(input, { target: { value: " Jan Nováková " } });
  fireEvent.blur(input);
  await waitFor(() => expect(h.setMemberName).toHaveBeenCalledWith("t", "u2", "Jan Nováková"));
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input);
  await waitFor(() => expect(h.setMemberName).toHaveBeenLastCalledWith("t", "u2", null));
});

test("unchanged value does not call the server", () => {
  renderPanel({ canNameMembers: true, member: { ...member, member_name: "Jan" } });
  fireEvent.blur(screen.getByLabelText("members.detail.nameLabel"));
  expect(h.setMemberName).not.toHaveBeenCalled();
});

test("Escape reverts the draft without closing the panel", () => {
  renderPanel({ canNameMembers: true, member: { ...member, member_name: "Jan" } });
  const input = screen.getByLabelText("members.detail.nameLabel") as HTMLInputElement;
  input.focus();
  fireEvent.change(input, { target: { value: "Other" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.value).toBe("Jan");
  expect(onClose).not.toHaveBeenCalled();
  expect(h.setMemberName).not.toHaveBeenCalled();
});

test("a failed save shows the error and restores the stored name", async () => {
  h.setMemberName.mockRejectedValue(new Error("nope"));
  renderPanel({ canNameMembers: true, member: { ...member, member_name: "Jan" } });
  const input = screen.getByLabelText("members.detail.nameLabel") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "X" } });
  fireEvent.blur(input);
  await screen.findByText("nope");
  expect(input.value).toBe("Jan");
});
