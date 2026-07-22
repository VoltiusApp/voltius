import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  revoke: vi.fn(),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/shared/BaseCard", () => ({
  BaseCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/services/teamService", () => ({ revokePendingInvitation: h.revoke }));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));

import { PendingInviteCard } from "./MembersPage";

const inv = {
  id: "inv1",
  display_name: "Jane Doe",
  role: "member",
  invited_by_display_name: null,
  created_at: "2024-01-01",
  expires_at: "2024-02-01",
};

const props = {
  inv,
  teamId: "t1",
  roles: [],
  onRevoked: vi.fn(),
};

beforeEach(() => {
  h.revoke.mockReset();
  props.onRevoked = vi.fn();
});
afterEach(() => cleanup());

test("renders display_name and role", () => {
  render(<PendingInviteCard {...props} />);
  expect(screen.getByText("Jane Doe")).toBeTruthy();
  expect(screen.getByText("member")).toBeTruthy();
});

test("click revoke calls revokePendingInvitation(teamId, inv.id) then onRevoked(inv.id)", async () => {
  h.revoke.mockResolvedValue(undefined);
  render(<PendingInviteCard {...props} />);
  fireEvent.click(screen.getByTitle("members.revokeInvitationTitle"));
  await waitFor(() => expect(props.onRevoked).toHaveBeenCalledWith("inv1"));
  expect(h.revoke).toHaveBeenCalledWith("t1", "inv1");
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
