import { test, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { TeamRole } from "@/stores/teamStore";

const h = vi.hoisted(() => ({
  inviteUserById: vi.fn(),
  searchUsers: vi.fn(),
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/services/vaultShare", () => ({
  inviteUserById: h.inviteUserById,
  inviteByEmailAddress: vi.fn(),
}));
vi.mock("@/services/teamService", () => ({ searchUsers: h.searchUsers }));

import { InviteControl } from "./InviteControl";

const roles = [
  { id: "r-owner", name: "owner", position: 0, is_builtin: true },
  { id: "r-member", name: "member", position: 1, is_builtin: true },
] as unknown as TeamRole[];

afterEach(cleanup);

test("a real click on a search result's Invite button invites that user", async () => {
  h.searchUsers.mockResolvedValue([{ user_id: "u1", handle: "dummy", display_name: "dummy", is_teammate: false }]);
  h.inviteUserById.mockResolvedValue({ status: "pending" });
  render(<InviteControl teamId="t1" roles={roles} existingIds={new Set()} usedSeats={1} seatCap={10} onInvited={vi.fn()} />);

  fireEvent.change(screen.getByPlaceholderText("members.invite.searchUserPlaceholder"), { target: { value: "dummy" } });
  const button = await screen.findByText("members.invite.inviteAction");

  fireEvent.mouseDown(button);
  fireEvent.click(screen.queryByText("members.invite.inviteAction") ?? document.body);

  await waitFor(() => expect(h.inviteUserById).toHaveBeenCalledWith(
    expect.objectContaining({ teamId: "t1", userId: "u1", roleName: "member" }),
  ));
});
