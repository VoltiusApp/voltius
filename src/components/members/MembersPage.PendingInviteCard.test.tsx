import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  revoke: vi.fn(),
  inviteByEmail: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/shared/BaseCard", () => ({
  BaseCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/services/vaultShare", () => ({
  inviteByEmailAddress: h.inviteByEmail,
  revokeInvitation: h.revoke,
}));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));

import { PendingInviteCard } from "./cards/PendingInviteCard";

const inv = {
  id: "inv1",
  display_name: "jade-heron-7715",
  role: "member",
  invited_by_display_name: null,
  created_at: "2024-01-01",
  expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  status: "pending" as const,
};

const props = {
  inv,
  teamId: "t1",
  roles: [],
  onRevoked: vi.fn(),
  onResent: vi.fn(),
};

beforeEach(() => {
  h.revoke.mockReset();
  h.inviteByEmail.mockReset();
  h.inviteByEmail.mockResolvedValue({ status: "invited" });
  props.onRevoked = vi.fn();
  props.onResent = vi.fn();
});
afterEach(() => cleanup());

test("renders the invitee handle and role", () => {
  render(<PendingInviteCard {...props} />);
  expect(screen.getByText("jade-heron-7715")).toBeTruthy();
  expect(screen.getByText("member")).toBeTruthy();
});

test("click revoke calls revokePendingInvitation(teamId, inv.id) then onRevoked(inv.id)", async () => {
  h.revoke.mockResolvedValue(undefined);
  render(<PendingInviteCard {...props} />);
  fireEvent.click(screen.getByTitle("members.revokeInvitationTitle"));
  await waitFor(() => expect(props.onRevoked).toHaveBeenCalledWith("inv1"));
  expect(h.revoke).toHaveBeenCalledWith(
    expect.objectContaining({ teamId: "t1", invitationId: "inv1" }),
  );
});

test("revoke rejection: onRevoked NOT called, no unhandled rejection", async () => {
  h.revoke.mockRejectedValue(new Error("x"));
  render(<PendingInviteCard {...props} />);
  const btn = screen.getByTitle("members.revokeInvitationTitle") as HTMLButtonElement;
  fireEvent.click(btn);
  await waitFor(() => expect(btn.disabled).toBe(false));
  expect(props.onRevoked).not.toHaveBeenCalled();
});

test("button disabled while revoke in flight, re-enables after resolve", async () => {
  let resolveRevoke: () => void;
  h.revoke.mockReturnValue(new Promise<void>((resolve) => { resolveRevoke = resolve; }));
  render(<PendingInviteCard {...props} />);
  const btn = screen.getByTitle("members.revokeInvitationTitle") as HTMLButtonElement;
  fireEvent.click(btn);
  await waitFor(() => expect(btn.disabled).toBe(true));
  resolveRevoke!();
  await waitFor(() => expect(btn.disabled).toBe(false));
});

test("shows how long a live invitation has left", () => {
  render(<PendingInviteCard {...props} />);

  expect(screen.getByText(/members\.invite\.expiresIn/)).toBeTruthy();
});

test("marks an expired invitation as expired rather than counting down", () => {
  const expired = { ...inv, status: "expired" as const, expires_at: "2024-01-08" };
  render(<PendingInviteCard {...props} inv={expired} />);

  // The badge says "Expired"; the line beneath the name says when it lapsed.
  expect(screen.getByText("members.invite.expired")).toBeTruthy();
  expect(screen.getByText(/members\.invite\.expiredOn/)).toBeTruthy();
  expect(screen.queryByText(/members\.invite\.expiresIn/)).toBeNull();
});

test("resend re-invites the same person with the same role", async () => {
  render(<PendingInviteCard {...props} />);

  fireEvent.click(screen.getByTitle("members.invite.resendTitle"));

  await waitFor(() =>
    expect(h.inviteByEmail).toHaveBeenCalledWith({
      teamId: "t1",
      email: "jade-heron-7715",
      roleName: "member",
    }),
  );
  await waitFor(() => expect(props.onResent).toHaveBeenCalled());
});

test("a failed resend does not report success", async () => {
  h.inviteByEmail.mockRejectedValue(new Error("nope"));
  render(<PendingInviteCard {...props} />);

  const btn = screen.getByTitle("members.invite.resendTitle") as HTMLButtonElement;
  fireEvent.click(btn);

  await waitFor(() => expect(btn.disabled).toBe(false));
  expect(props.onResent).not.toHaveBeenCalled();
});

test("both actions are permanent buttons, not hover-only", () => {
  render(<PendingInviteCard {...props} />);

  expect(screen.getByTitle("members.revokeInvitationTitle").className).not.toContain("group-hover");
  expect(screen.getByTitle("members.invite.resendTitle").className).not.toContain("group-hover");
});
