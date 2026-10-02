import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { TeamRole } from "@/stores/teamStore";

const h = vi.hoisted(() => ({
  usedSeats: 0,
  inviteUserWithRoles: vi.fn(),
  inviteByEmailAddress: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/vaultShare", () => ({
  inviteUserWithRoles: h.inviteUserWithRoles,
  inviteByEmailAddress: h.inviteByEmailAddress,
  inviteFailureReason: () => "",
}));
vi.mock("@/hooks/useUserSearch", () => ({
  useUserSearch: () => ({
    query: "new@corp.cz",
    setQuery: vi.fn(),
    results: [],
    searching: false,
    open: true,
    setOpen: vi.fn(),
    inputRef: { current: null },
    dropdownRef: { current: null },
    reset: vi.fn(),
  }),
}));
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: () => ({ usedSeats: h.usedSeats, effectiveSeats: 10, load: vi.fn() }),
}));
vi.mock("@/components/settings/BuySeatsModal", () => ({
  default: ({ onSuccess }: { onSuccess: () => void }) => <button onClick={onSuccess}>seats-bought</button>,
}));
vi.mock("@/components/members/SeatsMeter", () => ({ SeatsMeter: () => null }));

import { InvitePanel } from "./InvitePanel";

const roles: TeamRole[] = [
  { id: "r1", team_id: "t", name: "member", is_builtin: true, permissions: 0, position: 1, created_at: "" },
];

afterEach(() => {
  cleanup();
  Object.values(h).forEach((m) => typeof m !== "number" && m.mockReset());
  h.usedSeats = 0;
});

function renderPanel(canNameMembers: boolean) {
  h.inviteByEmailAddress.mockResolvedValue(undefined);
  return render(
    <InvitePanel
      teamId="t"
      existingIds={new Set()}
      teamRoles={roles}
      canNameMembers={canNameMembers}
      onClose={() => {}}
      onMemberAdded={() => {}}
    />,
  );
}

test("Name field is hidden without naming permission", () => {
  renderPanel(false);
  expect(screen.queryByLabelText("members.invite.nameLabel")).toBeNull();
});

test("email invite sends the typed name", async () => {
  renderPanel(true);
  fireEvent.change(screen.getByLabelText("members.invite.nameLabel"), { target: { value: "  Jan Novák " } });
  fireEvent.click(screen.getByText("members.invite.inviteArrow"));
  await waitFor(() =>
    expect(h.inviteByEmailAddress).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@corp.cz", memberName: "Jan Novák" }),
    ),
  );
});

test("blank name is not sent", async () => {
  renderPanel(true);
  fireEvent.click(screen.getByText("members.invite.inviteArrow"));
  await waitFor(() =>
    expect(h.inviteByEmailAddress).toHaveBeenCalledWith(expect.objectContaining({ memberName: undefined })),
  );
});

test("a name typed before buying seats does not leak into the next invite", () => {
  h.usedSeats = 10;
  renderPanel(true);
  const input = screen.getByLabelText("members.invite.nameLabel") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "Jan" } });
  fireEvent.click(screen.getByText("members.invite.inviteArrow"));
  fireEvent.click(screen.getByText("seats-bought"));
  expect(input.value).toBe("");
});
