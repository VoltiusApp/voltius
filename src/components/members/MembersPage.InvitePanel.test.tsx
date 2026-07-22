import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import type { TeamRole } from "@/stores/teamStore";

const h = vi.hoisted(() => ({
  searchUsers: vi.fn(),
  inviteByEmail: vi.fn(),
  add: vi.fn(),
  assign: vi.fn(),
  reload: vi.fn(),
  usedSeats: 2,
  totalSeats: 3,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));
vi.mock("@/components/shared/Panel", () => ({
  PanelShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PanelHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PanelHeaderIconButton: () => null,
  FormSection: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/services/teamService", () => ({
  searchUsers: h.searchUsers,
  getMyUserId: vi.fn(),
  getMyEmail: vi.fn(),
  inviteByEmail: h.inviteByEmail,
  revokePendingInvitation: vi.fn(),
}));
vi.mock("@/services/teamActionFeedback", () => ({
  runTeamAction: async (o: { run: () => Promise<unknown> }) => o.run(),
}));
vi.mock("@/stores/teamStore", () => {
  const state = { addMemberById: h.add, assignMemberRole: h.assign };
  const useTeamStore = Object.assign(
    (sel: (s: typeof state) => unknown) => sel(state),
    { getState: () => state },
  );
  return { useTeamStore };
});
vi.mock("@/stores/subscriptionStore", () => ({
  useSubscriptionStore: Object.assign(
    () => ({ usedSeats: h.usedSeats, totalSeats: h.totalSeats, load: h.reload }),
    { getState: () => ({ load: h.reload }) },
  ),
}));
vi.mock("@/components/settings/BuySeatsModal", () => ({
  default: ({
    pendingUser,
    pendingRole,
    onSuccess,
  }: {
    pendingUser: { user_id: string } | null;
    pendingRole: string;
    onSuccess: () => void;
  }) => (
    <div data-testid="buy-seats-modal" data-pending-user={pendingUser?.user_id ?? "none"} data-role={pendingRole}>
      <button data-testid="buy-seats-success" onClick={onSuccess}>ok</button>
    </div>
  ),
}));

import { InvitePanel } from "./MembersPage";

const teamRoles: TeamRole[] = [
  { id: "r-owner", team_id: "t1", name: "owner", is_builtin: true, permissions: 0, position: 0, created_at: "" },
  { id: "r-mem", team_id: "t1", name: "member", is_builtin: true, permissions: 0, position: 1, created_at: "" },
];

const baseProps = {
  teamId: "t1",
  existingIds: new Set<string>(),
  teamRoles,
  onClose: vi.fn(),
  onMemberAdded: vi.fn(),
};

const inA = { user_id: "inA", display_name: "Included A", public_key: "pkA" };

beforeEach(() => {
  h.searchUsers.mockReset();
  h.inviteByEmail.mockReset();
  h.add.mockReset();
  h.assign.mockReset();
  h.reload.mockReset().mockResolvedValue(undefined);
  h.usedSeats = 2;
  h.totalSeats = 3;
  baseProps.onClose = vi.fn();
  baseProps.onMemberAdded = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function getInput() {
  return screen.getByPlaceholderText("members.invite.searchByEmailPlaceholder");
}

/** Types a query and advances the 250ms debounce under fake timers, flushing the search promise. */
async function typeAndDebounce(value: string) {
  fireEvent.change(getInput(), { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
}

test("debounce gate: no search below length 2, exactly one call after 250ms", async () => {
  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([]);
  render(<InvitePanel {...baseProps} />);

  fireEvent.change(getInput(), { target: { value: "a" } });
  expect(h.searchUsers).not.toHaveBeenCalled();

  fireEvent.change(getInput(), { target: { value: "ab" } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(100);
  });
  expect(h.searchUsers).not.toHaveBeenCalled();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
  expect(h.searchUsers).toHaveBeenCalledTimes(1);
  expect(h.searchUsers).toHaveBeenCalledWith("ab");
});

test("existingIds filter: excluded id absent from rendered results, included id present", async () => {
  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([
    inA,
    { user_id: "inB", display_name: "Excluded B", public_key: "pkB" },
  ]);
  render(<InvitePanel {...baseProps} existingIds={new Set(["inB"])} />);

  await typeAndDebounce("in");

  expect(screen.getByText("Included A")).toBeTruthy();
  expect(screen.queryByText("Excluded B")).toBeNull();
});

test("add success (not at limit): addMemberById + assignMemberRole(default role) + reload + onMemberAdded", async () => {
  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([inA]);
  h.add.mockResolvedValue({ status: "pending" });
  h.assign.mockResolvedValue(undefined);
  render(<InvitePanel {...baseProps} />);

  await typeAndDebounce("in");
  vi.useRealTimers();
  h.reload.mockClear();
  fireEvent.click(screen.getByText("Included A"));

  await waitFor(() => expect(baseProps.onMemberAdded).toHaveBeenCalled());
  expect(h.add).toHaveBeenCalledWith("t1", "inA");
  expect(h.assign).toHaveBeenCalledWith("t1", "inA", "r-mem");
  expect(h.reload).toHaveBeenCalled();
});

test("add at seat limit: addMemberById NOT called, BuySeatsModal shown with that user", async () => {
  h.usedSeats = 3;
  h.totalSeats = 3;
  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([inA]);
  render(<InvitePanel {...baseProps} />);

  await typeAndDebounce("in");
  vi.useRealTimers();
  fireEvent.click(screen.getByText("Included A"));

  expect(h.add).not.toHaveBeenCalled();
  const modal = await screen.findByTestId("buy-seats-modal");
  expect(modal.dataset.pendingUser).toBe("inA");
});

test("add rejects {code:402} (not at limit): BuySeatsModal shown, no error text", async () => {
  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([inA]);
  h.add.mockRejectedValue(Object.assign(new Error("x"), { code: 402 }));
  render(<InvitePanel {...baseProps} />);

  await typeAndDebounce("in");
  vi.useRealTimers();
  fireEvent.click(screen.getByText("Included A"));

  const modal = await screen.findByTestId("buy-seats-modal");
  expect(modal.dataset.pendingUser).toBe("inA");
  expect(screen.queryByText("x")).toBeNull();
});

test("add rejects Error with '402' in message (no code prop): BuySeatsModal shown", async () => {
  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([inA]);
  h.add.mockRejectedValue(new Error("boom 402 detail"));
  render(<InvitePanel {...baseProps} />);

  await typeAndDebounce("in");
  vi.useRealTimers();
  fireEvent.click(screen.getByText("Included A"));

  const modal = await screen.findByTestId("buy-seats-modal");
  expect(modal.dataset.pendingUser).toBe("inA");
  expect(screen.queryByText("boom 402 detail")).toBeNull();
});

test("add rejects generic error (no 402): error text shown, BuySeatsModal NOT rendered", async () => {
  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([inA]);
  h.add.mockRejectedValue(new Error("nope"));
  render(<InvitePanel {...baseProps} />);

  await typeAndDebounce("in");
  vi.useRealTimers();
  fireEvent.click(screen.getByText("Included A"));

  expect(await screen.findByText("nope")).toBeTruthy();
  expect(screen.queryByTestId("buy-seats-modal")).toBeNull();
});

test("email invite success (not at limit): inviteByEmail(default role) + reload + onMemberAdded", async () => {
  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([]);
  h.inviteByEmail.mockResolvedValue({ status: "invited" });
  render(<InvitePanel {...baseProps} />);

  await typeAndDebounce("a@b.com");
  vi.useRealTimers();
  h.reload.mockClear();
  fireEvent.click(await screen.findByRole("button", { name: /sendInviteLabel/ }));

  await waitFor(() => expect(baseProps.onMemberAdded).toHaveBeenCalled());
  expect(h.inviteByEmail).toHaveBeenCalledWith("t1", "a@b.com", "member");
  expect(h.reload).toHaveBeenCalled();
});

test("email invite at seat limit: BuySeatsModal(null); inviteByEmail NOT called", async () => {
  h.usedSeats = 3;
  h.totalSeats = 3;
  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([]);
  render(<InvitePanel {...baseProps} />);

  await typeAndDebounce("a@b.com");
  vi.useRealTimers();
  fireEvent.click(await screen.findByRole("button", { name: /sendInviteLabel/ }));

  const modal = await screen.findByTestId("buy-seats-modal");
  expect(modal.dataset.pendingUser).toBe("none");
  expect(h.inviteByEmail).not.toHaveBeenCalled();
});

test("email invite rejects 402: BuySeatsModal(null)", async () => {
  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([]);
  h.inviteByEmail.mockRejectedValue(Object.assign(new Error("x"), { code: 402 }));
  render(<InvitePanel {...baseProps} />);

  await typeAndDebounce("a@b.com");
  vi.useRealTimers();
  fireEvent.click(await screen.findByRole("button", { name: /sendInviteLabel/ }));

  const modal = await screen.findByTestId("buy-seats-modal");
  expect(modal.dataset.pendingUser).toBe("none");
});

test("email invite rejects generic error (no 402): error text shown, no modal", async () => {
  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([]);
  h.inviteByEmail.mockRejectedValue(new Error("nope"));
  render(<InvitePanel {...baseProps} />);

  await typeAndDebounce("a@b.com");
  vi.useRealTimers();
  fireEvent.click(await screen.findByRole("button", { name: /sendInviteLabel/ }));

  expect(await screen.findByText("nope")).toBeTruthy();
  expect(screen.queryByTestId("buy-seats-modal")).toBeNull();
});

test("BuySeatsModal onSuccess: reloadSubscription + onMemberAdded called, modal closes", async () => {
  h.usedSeats = 3;
  h.totalSeats = 3;
  vi.useFakeTimers();
  h.searchUsers.mockResolvedValue([inA]);
  render(<InvitePanel {...baseProps} />);

  await typeAndDebounce("in");
  vi.useRealTimers();
  fireEvent.click(screen.getByText("Included A"));
  await screen.findByTestId("buy-seats-modal");
  h.reload.mockClear();

  fireEvent.click(screen.getByTestId("buy-seats-success"));

  await waitFor(() => expect(baseProps.onMemberAdded).toHaveBeenCalled());
  expect(h.reload).toHaveBeenCalled();
  expect(screen.queryByTestId("buy-seats-modal")).toBeNull();
});
