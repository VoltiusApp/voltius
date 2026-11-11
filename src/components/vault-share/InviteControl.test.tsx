import { test, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type { TeamRole } from "@/stores/teamStore";

const h = vi.hoisted(() => ({
  multiOwner: false,
  viewerIsOwner: true,
  inviteUserById: vi.fn(),
  inviteByEmailAddress: vi.fn(),
  results: [] as unknown[],
}));

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/stores/teamStore", () => ({ useTeamStore: (sel: (s: object) => unknown) => sel({ membersByTeam: {} }) }));
vi.mock("@/hooks/useMyUserId", () => ({ useMyUserId: () => "me" }));
vi.mock("@/hooks/useOwnershipContext", () => ({
  useOwnershipContext: () => ({ multiOwner: h.multiOwner, viewerIsOwner: h.viewerIsOwner }),
}));
vi.mock("@/services/vaultShare", () => ({
  inviteUserById: h.inviteUserById,
  inviteByEmailAddress: h.inviteByEmailAddress,
}));
vi.mock("@/hooks/useUserSearch", () => ({
  useUserSearch: () => ({
    query: "bob", setQuery: vi.fn(), results: h.results, searching: false,
    open: true, setOpen: vi.fn(), inputRef: { current: null }, dropdownRef: { current: null },
    reset: vi.fn(),
  }),
}));

import { InviteControl } from "./InviteControl";
import { seatState } from "@/services/seatMath";

const roles = [
  { id: "r-owner", name: "owner", position: 0, is_builtin: true },
  { id: "r-manager", name: "manager", position: 1, is_builtin: true },
  { id: "r-editor", name: "editor", position: 2, is_builtin: true },
] as unknown as TeamRole[];

beforeEach(() => { h.inviteUserById.mockReset(); h.results = []; h.multiOwner = false; h.viewerIsOwner = true; });
afterEach(cleanup);

test("owner is not offered by a server without multiple owners", () => {
  render(<InviteControl teamId="t1" roles={roles} existingIds={new Set()} seats={seatState(1, 10)} onInvited={vi.fn()} />);
  expect(screen.queryByText("members.roleName.owner")).toBeNull();
  expect(screen.getByText("members.roleName.manager")).toBeTruthy();
});

test("the custom-handle search rule is stated", () => {
  render(<InviteControl teamId="t1" roles={roles} existingIds={new Set()} seats={seatState(1, 10)} onInvited={vi.fn()} />);
  expect(screen.getByText("members.invite.handleRule")).toBeTruthy();
});

test("seats render an explicit unknown state, never a question mark", () => {
  render(<InviteControl teamId="t1" roles={roles} existingIds={new Set()} seats={{ kind: "unknown" }} onInvited={vi.fn()} />);
  expect(screen.getByText("members.invite.seatsUnknown")).toBeTruthy();
});

test("with no role named member, the least privileged role is the default", () => {
  const noMemberRoles = [
    { id: "r-owner", name: "owner", position: 0, is_builtin: true },
    { id: "r-manager", name: "manager", position: 1, is_builtin: true },
    { id: "r-editor", name: "editor", position: 2, is_builtin: true },
    { id: "r-connect", name: "connect-only", position: 3, is_builtin: true },
  ] as unknown as TeamRole[];
  render(<InviteControl teamId="t1" roles={noMemberRoles} existingIds={new Set()} seats={seatState(1, 10)} onInvited={vi.fn()} />);
  expect(screen.getByText("members.roleName.connect-only").getAttribute("aria-pressed")).toBe("true");
});

test("choosing a role and a person invites with that role", async () => {
  h.results = [{ user_id: "u1", handle: "bob-builder", display_name: "bob-builder", is_teammate: false }];
  h.inviteUserById.mockResolvedValue({ status: "pending" });
  render(<InviteControl teamId="t1" roles={roles} existingIds={new Set()} seats={seatState(1, 10)} onInvited={vi.fn()} />);
  fireEvent.click(screen.getByText("members.roleName.editor"));
  fireEvent.click(screen.getByText("members.invite.inviteAction"));
  await waitFor(() => expect(h.inviteUserById).toHaveBeenCalledWith(
    expect.objectContaining({ teamId: "t1", userId: "u1", roleName: "editor", roleId: "r-editor" }),
  ));
});

test("a non-Owner sees Owner greyed out with the reason", () => {
  h.multiOwner = true;
  h.viewerIsOwner = false;
  render(<InviteControl teamId="t1" roles={roles} existingIds={new Set()} seats={seatState(1, 10)} onInvited={vi.fn()} />);
  const chip = screen.getByText("members.roleName.owner").closest("button")!;
  expect(chip.disabled).toBe(true);
  expect(chip.title).toBe("members.invite.ownerOnlyOwners");
});

test("an Owner invite is sent only after the confirmation", async () => {
  h.multiOwner = true;
  h.results = [{ user_id: "u1", handle: "bob-builder", display_name: "bob-builder", is_teammate: false }];
  h.inviteUserById.mockResolvedValue({ status: "pending" });
  render(<InviteControl teamId="t1" roles={roles} existingIds={new Set()} seats={seatState(1, 10)} onInvited={vi.fn()} />);
  fireEvent.click(screen.getByText("members.roleName.owner"));
  fireEvent.click(screen.getByText("members.invite.inviteAction"));
  expect(h.inviteUserById).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("members.ownership.invite.confirm"));
  await waitFor(() => expect(h.inviteUserById).toHaveBeenCalledWith(
    expect.objectContaining({ userId: "u1", roleName: "owner", roleId: "r-owner" }),
  ));
});
