import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const roster = [
  { user_id: "u-alice", team_id: "t1", display_name: "Alice", is_online: true, teamIds: ["t1"] },
  { user_id: "u-bob", team_id: "t2", display_name: "Bob", is_online: false, teamIds: ["t2"] },
];

const h = vi.hoisted(() => ({ allTeammates: vi.fn() }));
vi.mock("@/services/teamSharing", async () => {
  const actual = await vi.importActual<typeof import("@/services/teamSharing")>("@/services/teamSharing");
  return { ...actual, allTeammates: h.allTeammates };
});

import { InvitePeopleSection } from "./InvitePeopleSection";
import { useTeamStore } from "@/stores/teamStore";

beforeEach(() => {
  h.allTeammates.mockReset().mockResolvedValue(roster);
  useTeamStore.setState({ teams: [] });
});
afterEach(() => cleanup());

// Default cap high enough that it never blocks the pre-existing behavioral tests below.
const HIGH_CAP = { guestCap: 10, tier: "teams" as const, onUpgrade: vi.fn() };

test("marks a covered teammate as having access and does not call onInvite", async () => {
  const onInvite = vi.fn();
  render(
    <InvitePeopleSection session={{ vaultIds: ["t1"], participantIds: [], invitedIds: [] }} {...HIGH_CAP} onInvite={onInvite} />,
  );
  const row = (await screen.findByRole("button", { name: /alice/i })) as HTMLButtonElement;
  expect(row.disabled).toBe(true);
  expect(screen.getByText("terminal.share.inviteHasAccess")).toBeTruthy();
  await userEvent.click(row);
  expect(onInvite).not.toHaveBeenCalled();
});

test("disables the row while an invite is in flight and shows Invited after", async () => {
  let resolve: () => void;
  const onInvite = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
  render(
    <InvitePeopleSection session={{ vaultIds: [], participantIds: [], invitedIds: [] }} {...HIGH_CAP} onInvite={onInvite} />,
  );
  const row = (await screen.findByRole("button", { name: /alice/i })) as HTMLButtonElement;
  await userEvent.click(row);
  expect(row.disabled).toBe(true);
  await userEvent.click(row);
  expect(onInvite).toHaveBeenCalledTimes(1);
  resolve!();
  expect(await screen.findByText("terminal.share.inviteSent")).toBeTruthy();
});

test("surfaces a failed invite inline and re-enables the row", async () => {
  const onInvite = vi.fn().mockRejectedValue(new Error("boom"));
  render(
    <InvitePeopleSection session={{ vaultIds: [], participantIds: [], invitedIds: [] }} {...HIGH_CAP} onInvite={onInvite} />,
  );
  const row = (await screen.findByRole("button", { name: /alice/i })) as HTMLButtonElement;
  await userEvent.click(row);
  expect(await screen.findByText("terminal.share.inviteFailed")).toBeTruthy();
  expect(row.disabled).toBe(false);
});

test("renders nothing while the roster is empty (no header flash)", async () => {
  h.allTeammates.mockResolvedValue([]);
  const { container } = render(
    <InvitePeopleSection session={{ vaultIds: [], participantIds: [], invitedIds: [] }} {...HIGH_CAP} onInvite={vi.fn()} />,
  );
  await screen.findByText("terminal.share.inviteNoTeammates");
  expect(container.querySelector("button")).toBeNull();
});

test("a failed roster load shows a distinct error, not the empty-roster message", async () => {
  h.allTeammates.mockRejectedValue(new Error("network"));
  render(
    <InvitePeopleSection session={{ vaultIds: [], participantIds: [], invitedIds: [] }} {...HIGH_CAP} onInvite={vi.fn()} />,
  );
  await screen.findByText("terminal.share.inviteLoadFailed");
  expect(screen.queryByText("terminal.share.inviteNoTeammates")).toBeNull();
});

test("reloads the roster when the team list changes (ShareMenu's loadTeams races the mount effect)", async () => {
  render(
    <InvitePeopleSection session={{ vaultIds: [], participantIds: [], invitedIds: [] }} {...HIGH_CAP} onInvite={vi.fn()} />,
  );
  await screen.findByRole("button", { name: /alice/i });
  expect(h.allTeammates).toHaveBeenCalledTimes(1);

  act(() => {
    useTeamStore.setState({ teams: [{ id: "t1", name: "Team", owner_tier: "teams" } as never] });
  });

  await waitFor(() => expect(h.allTeammates).toHaveBeenCalledTimes(2));
});

// ─── Guest cap (#66 follow-up: the cap was invisible in the direct-invite roster) ──

test("a Pro host at cap 1 with one participant disables every not-already-covered row and shows the cap notice", async () => {
  const onInvite = vi.fn();
  render(
    <InvitePeopleSection
      session={{ vaultIds: [], participantIds: ["u-existing"], invitedIds: [] }}
      guestCap={1}
      tier="pro"
      onUpgrade={vi.fn()}
      onInvite={onInvite}
    />,
  );
  const alice = (await screen.findByRole("button", { name: /alice/i })) as HTMLButtonElement;
  const bob = (await screen.findByRole("button", { name: /bob/i })) as HTMLButtonElement;
  expect(alice.disabled).toBe(true);
  expect(bob.disabled).toBe(true);
  expect(screen.getAllByText("terminal.share.inviteCapReached").length).toBe(2);
  expect(screen.getByText("terminal.share.participantsRatio")).toBeTruthy();

  await userEvent.click(alice);
  expect(onInvite).not.toHaveBeenCalled();
});

test("a Teams host at cap 10 with two participants leaves rows tappable", async () => {
  render(
    <InvitePeopleSection
      session={{ vaultIds: [], participantIds: ["u1", "u2"], invitedIds: [] }}
      guestCap={10}
      tier="teams"
      onUpgrade={vi.fn()}
      onInvite={vi.fn()}
    />,
  );
  const alice = (await screen.findByRole("button", { name: /alice/i })) as HTMLButtonElement;
  expect(alice.disabled).toBe(false);
  expect(screen.queryByText("terminal.share.inviteCapReached")).toBeNull();
});

test("a teammate in both participantIds and invitedIds counts once, not twice", async () => {
  render(
    <InvitePeopleSection
      session={{ vaultIds: [], participantIds: ["dup"], invitedIds: ["dup"] }}
      guestCap={2}
      tier="teams"
      onUpgrade={vi.fn()}
      onInvite={vi.fn()}
    />,
  );
  // Committed seats = 1 (deduped). If counted twice, this would read 2 and hit the cap.
  const alice = (await screen.findByRole("button", { name: /alice/i })) as HTMLButtonElement;
  expect(alice.disabled).toBe(false);
});

test("after inviting one teammate at cap 1 with no participants, the remaining rows go non-tappable without a prop change", async () => {
  const onInvite = vi.fn().mockResolvedValue(undefined);
  render(
    <InvitePeopleSection
      session={{ vaultIds: [], participantIds: [], invitedIds: [] }}
      guestCap={1}
      tier="pro"
      onUpgrade={vi.fn()}
      onInvite={onInvite}
    />,
  );
  const alice = (await screen.findByRole("button", { name: /alice/i })) as HTMLButtonElement;
  const bob = (await screen.findByRole("button", { name: /bob/i })) as HTMLButtonElement;
  expect(bob.disabled).toBe(false);

  await userEvent.click(alice);
  await screen.findByText("terminal.share.inviteSent");

  expect(bob.disabled).toBe(true);
  expect(screen.getByText("terminal.share.inviteCapReached")).toBeTruthy();
});
