import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, cleanup, waitFor, within, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const h = vi.hoisted(() => ({ allTeammates: vi.fn(), searchUsers: vi.fn() }));
vi.mock("@/services/teamSharing", async () => {
  const actual = await vi.importActual<typeof import("@/services/teamSharing")>("@/services/teamSharing");
  return { ...actual, allTeammates: h.allTeammates };
});
vi.mock("@/services/teamService", async () => {
  const actual = await vi.importActual<typeof import("@/services/teamService")>("@/services/teamService");
  return { ...actual, searchUsers: h.searchUsers };
});

import { PeopleTab } from "./PeopleTab";
import { useRecentPeopleStore } from "@/stores/recentPeopleStore";
import { useTeamStore } from "@/stores/teamStore";

const base = {
  session: { vaultIds: [], participantIds: [], invitedIds: [] },
  invitedThisSession: new Set<string>(),
  guestCap: 10,
  tier: "teams" as const,
  onUpgrade: vi.fn(),
  onInvite: vi.fn().mockResolvedValue(undefined),
};

beforeEach(() => {
  h.allTeammates.mockReset().mockResolvedValue([]);
  h.searchUsers.mockReset().mockResolvedValue([]);
  useTeamStore.setState({ teams: [] });
  useRecentPeopleStore.setState({ recent: [], recentUpdatedAt: "" });
});
afterEach(() => cleanup());

test("teaches the resolution rule when nothing matches", async () => {
  h.allTeammates.mockResolvedValue([]);
  h.searchUsers.mockResolvedValue([]);
  render(<PeopleTab {...base} />);
  await userEvent.type(screen.getByRole("textbox"), "kev");
  expect(await screen.findByText("terminal.share.peopleNoMatch")).toBeTruthy();
  expect(screen.getByText("terminal.share.peopleFindRule")).toBeTruthy();
});

test("a stranger row is marked and shows its handle", async () => {
  h.allTeammates.mockResolvedValue([]);
  h.searchUsers.mockResolvedValue([{ user_id: "s1", handle: "sam-q", is_teammate: false }]);
  render(<PeopleTab {...base} />);
  await userEvent.type(screen.getByRole("textbox"), "sam-q");
  const row = await screen.findByRole("button", { name: /sam/i });
  expect(within(row).getByText("terminal.share.notInYourTeams")).toBeTruthy();
  expect(within(row).getByText("@sam-q")).toBeTruthy();
});

test("a recent row already in the session renders as having access and cannot be invited", async () => {
  useRecentPeopleStore.setState({ recent: [{ user_id: "r1", handle: "kevin-p-6620", last_invited_at: "" }], recentUpdatedAt: "" });
  const onInvite = vi.fn();
  render(<PeopleTab {...base} session={{ vaultIds: [], participantIds: ["r1"], invitedIds: [] }} onInvite={onInvite} />);
  const row = await screen.findByRole("button", { name: /kevin-p-6620/i });
  expect((row as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(row);
  expect(onInvite).not.toHaveBeenCalled();
});

test("inviting remembers the person", async () => {
  h.searchUsers.mockResolvedValue([{ user_id: "s1", handle: "sam-q", is_teammate: false }]);
  render(<PeopleTab {...base} onInvite={async () => {}} />);
  await userEvent.type(screen.getByRole("textbox"), "sam-q");
  await userEvent.click(await screen.findByRole("button", { name: /sam/i }));
  await waitFor(() => expect(useRecentPeopleStore.getState().recent[0].user_id).toBe("s1"));
});

test("Recent's own empty state stands alone even while Your teams has results", async () => {
  h.allTeammates.mockResolvedValue([{ user_id: "u-alice", team_id: "t1", handle: "amber-lynx-4410", is_online: true, teamIds: ["t1"] }]);
  render(<PeopleTab {...base} />);
  await screen.findByRole("button", { name: /amber-lynx-4410/i });
  expect(screen.getByText("terminal.share.recentEmpty")).toBeTruthy();
});

test("a recent row can be forgotten from the row itself", async () => {
  useRecentPeopleStore.setState({ recent: [{ user_id: "r1", handle: "kevin-p-6620", last_invited_at: "" }], recentUpdatedAt: "" });
  render(<PeopleTab {...base} />);
  await userEvent.click(await screen.findByRole("button", { name: "terminal.share.forgetPerson" }));
  expect(useRecentPeopleStore.getState().recent).toHaveLength(0);
  expect(screen.queryByRole("button", { name: /kevin-p-6620/i })).toBeNull();
});

test("forgetting does not invite: the forget control is its own target", async () => {
  useRecentPeopleStore.setState({ recent: [{ user_id: "r1", handle: "kevin-p-6620", last_invited_at: "" }], recentUpdatedAt: "" });
  const onInvite = vi.fn();
  render(<PeopleTab {...base} onInvite={onInvite} />);
  await userEvent.click(await screen.findByRole("button", { name: "terminal.share.forgetPerson" }));
  expect(onInvite).not.toHaveBeenCalled();
});

// Nothing to forget on a teammate or a search hit — the row is derived from the
// roster/server, not from local Recent, so an X there would promise a deletion
// the store cannot make.
test("only recent rows offer forget", async () => {
  h.allTeammates.mockResolvedValue(roster);
  h.searchUsers.mockResolvedValue([{ user_id: "s1", handle: "sam-q", is_teammate: false }]);
  render(<PeopleTab {...base} />);
  await userEvent.type(screen.getByRole("textbox"), "sam-q");
  await screen.findByRole("button", { name: /sam-q/i });
  expect(screen.queryByRole("button", { name: "terminal.share.forgetPerson" })).toBeNull();
});

test("an invitable row reads as clickable and a blocked one does not", async () => {
  h.allTeammates.mockResolvedValue(roster);
  render(<PeopleTab {...base} session={{ vaultIds: ["t1"], participantIds: [], invitedIds: [] }} />);
  const covered = await screen.findByRole("button", { name: /amber-lynx-4410/i });
  const open = await screen.findByRole("button", { name: /brisk-otter-8823/i });
  expect(open.className).toContain("cursor-pointer");
  expect(covered.className).not.toContain("cursor-pointer");
});

// ─── Moved from InvitePeopleSection.test.tsx (that component was deleted; PeopleTab
// replaced it as ShareMenu's only invite surface) ───────────────────────────────

const roster = [
  { user_id: "u-alice", team_id: "t1", handle: "amber-lynx-4410", is_online: true, teamIds: ["t1"] },
  { user_id: "u-bob", team_id: "t2", handle: "brisk-otter-8823", is_online: false, teamIds: ["t2"] },
];

type TabProps = Parameters<typeof PeopleTab>[0];

/**
 * Mirrors ShareMenu's ownership of `invitedThisSession`: it lives in the parent
 * because it has to outlive any single PeopleTab instance (the first invite on
 * an unshared terminal flips the setup view to the active view, remounting it).
 */
function Harness({ onInvite, ...props }: Omit<TabProps, "invitedThisSession">) {
  const [invited, setInvited] = useState<ReadonlySet<string>>(new Set());
  const handleInvite = async (target: Parameters<TabProps["onInvite"]>[0]) => {
    await onInvite(target);
    setInvited((prev) => new Set(prev).add(target.user_id));
  };
  return <PeopleTab {...props} invitedThisSession={invited} onInvite={handleInvite} />;
}

test("a teammate row shows its handle when present", async () => {
  h.allTeammates.mockResolvedValue([{ user_id: "u-alice", team_id: "t1", handle: "amber-lynx-4410", is_online: true, teamIds: ["t1"] }]);
  render(<PeopleTab {...base} />);
  const row = await screen.findByRole("button", { name: /amber-lynx-4410/i });
  expect(within(row).getByText("@amber-lynx-4410")).toBeTruthy();
});

test("marks a covered teammate as having access and does not call onInvite", async () => {
  h.allTeammates.mockResolvedValue(roster);
  const onInvite = vi.fn();
  render(<PeopleTab {...base} session={{ vaultIds: ["t1"], participantIds: [], invitedIds: [] }} onInvite={onInvite} />);
  const row = (await screen.findByRole("button", { name: /amber-lynx-4410/i })) as HTMLButtonElement;
  expect(row.disabled).toBe(true);
  expect(within(row).getByText("terminal.share.inviteHasAccess")).toBeTruthy();
  await userEvent.click(row);
  expect(onInvite).not.toHaveBeenCalled();
});

// Recent wins the dedupe, so the teammate's teamIds only reach memberHasAccess
// if the Recent row carries them. Without that, tapping issues a real grant and
// spends a guest seat on someone who already has access.
test("a teammate who is also in Recent still renders as having access in their vault's session", async () => {
  h.allTeammates.mockResolvedValue(roster);
  useRecentPeopleStore.setState({
    recent: [{ user_id: "u-alice", handle: "amber-lynx-4410", last_invited_at: "" }],
    recentUpdatedAt: "",
  });
  const onInvite = vi.fn();
  render(<PeopleTab {...base} session={{ vaultIds: ["t1"], participantIds: [], invitedIds: [] }} onInvite={onInvite} />);
  const rows = await screen.findAllByRole("button", { name: /amber-lynx-4410/i });
  expect(rows).toHaveLength(1);
  expect((rows[0] as HTMLButtonElement).disabled).toBe(true);
  expect(within(rows[0]).getByText("terminal.share.inviteHasAccess")).toBeTruthy();
  await userEvent.click(rows[0]);
  expect(onInvite).not.toHaveBeenCalled();
});

test("disables the row while an invite is in flight and shows Invited after", async () => {
  h.allTeammates.mockResolvedValue(roster);
  let resolve: () => void;
  const onInvite = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
  render(<Harness {...base} onInvite={onInvite} />);
  const row = (await screen.findByRole("button", { name: /amber-lynx-4410/i })) as HTMLButtonElement;
  await userEvent.click(row);
  expect(row.disabled).toBe(true);
  await userEvent.click(row);
  expect(onInvite).toHaveBeenCalledTimes(1);
  resolve!();
  expect(await screen.findByText("terminal.share.inviteSent")).toBeTruthy();
});

test("surfaces a failed invite inline and re-enables the row", async () => {
  h.allTeammates.mockResolvedValue(roster);
  const onInvite = vi.fn().mockRejectedValue(new Error("boom"));
  render(<PeopleTab {...base} onInvite={onInvite} />);
  const row = (await screen.findByRole("button", { name: /amber-lynx-4410/i })) as HTMLButtonElement;
  await userEvent.click(row);
  expect(await screen.findByText("terminal.share.inviteFailed")).toBeTruthy();
  expect(row.disabled).toBe(false);
});

// ─── Roster load failure (moved from InvitePeopleSection.test.tsx: a failed fetch
// must never read as "this team has no one to invite") ─────────────────────────

test("a failed roster load shows a distinct error, not the empty-roster message", async () => {
  h.allTeammates.mockRejectedValue(new Error("network"));
  render(<PeopleTab {...base} />);
  await screen.findByText("terminal.share.inviteLoadFailed");
  // "Your teams" only renders when there are teammate rows, so with the load
  // failed it's simply absent — the failure banner is the only signal shown.
  expect(screen.queryByText("terminal.share.yourTeamsLabel")).toBeNull();
});

test("does not show a load-failure message while the roster request is still pending", () => {
  h.allTeammates.mockReturnValue(new Promise(() => {})); // never resolves
  render(<PeopleTab {...base} />);
  expect(screen.queryByText("terminal.share.inviteLoadFailed")).toBeNull();
});

test("reloads the roster when the team list changes (ShareMenu's loadTeams races the mount effect)", async () => {
  h.allTeammates.mockResolvedValue(roster);
  render(<PeopleTab {...base} />);
  await screen.findByRole("button", { name: /amber-lynx-4410/i });
  expect(h.allTeammates).toHaveBeenCalledTimes(1);

  act(() => {
    useTeamStore.setState({ teams: [{ id: "t1", name: "Team", owner_tier: "teams" } as never] });
  });

  await waitFor(() => expect(h.allTeammates).toHaveBeenCalledTimes(2));
});

// ─── Guest cap (#66 follow-up: the cap was invisible in the direct-invite roster) ──

test("a Pro host at cap 1 with one participant disables every not-already-covered row and shows the cap notice", async () => {
  h.allTeammates.mockResolvedValue(roster);
  const onInvite = vi.fn();
  render(
    <PeopleTab
      {...base}
      session={{ vaultIds: [], participantIds: ["u-existing"], invitedIds: [] }}
      guestCap={1}
      tier="pro"
      onInvite={onInvite}
    />,
  );
  const alice = (await screen.findByRole("button", { name: /amber-lynx-4410/i })) as HTMLButtonElement;
  const bob = (await screen.findByRole("button", { name: /brisk-otter-8823/i })) as HTMLButtonElement;
  expect(alice.disabled).toBe(true);
  expect(bob.disabled).toBe(true);
  expect(screen.getAllByText("terminal.share.inviteCapReached").length).toBe(2);
  expect(screen.getByText("terminal.share.guestsRatio")).toBeTruthy();
  expect(screen.queryByText("terminal.share.participantsRatio")).toBeNull();

  await userEvent.click(alice);
  expect(onInvite).not.toHaveBeenCalled();
});

test("a Teams host at cap 10 with two participants leaves rows tappable", async () => {
  h.allTeammates.mockResolvedValue(roster);
  render(
    <PeopleTab {...base} session={{ vaultIds: [], participantIds: ["u1", "u2"], invitedIds: [] }} guestCap={10} tier="teams" />,
  );
  const alice = (await screen.findByRole("button", { name: /amber-lynx-4410/i })) as HTMLButtonElement;
  expect(alice.disabled).toBe(false);
  expect(screen.queryByText("terminal.share.inviteCapReached")).toBeNull();
});

test("a teammate in both participantIds and invitedIds counts once, not twice", async () => {
  h.allTeammates.mockResolvedValue(roster);
  render(
    <PeopleTab {...base} session={{ vaultIds: [], participantIds: ["dup"], invitedIds: ["dup"] }} guestCap={2} tier="teams" />,
  );
  // Committed seats = 1 (deduped). If counted twice, this would read 2 and hit the cap.
  const alice = (await screen.findByRole("button", { name: /amber-lynx-4410/i })) as HTMLButtonElement;
  expect(alice.disabled).toBe(false);
});

test("after inviting one teammate at cap 1 with no participants, the remaining rows go non-tappable", async () => {
  h.allTeammates.mockResolvedValue(roster);
  const onInvite = vi.fn().mockResolvedValue(undefined);
  render(<Harness {...base} guestCap={1} tier="pro" onInvite={onInvite} />);
  const alice = (await screen.findByRole("button", { name: /amber-lynx-4410/i })) as HTMLButtonElement;
  const bob = (await screen.findByRole("button", { name: /brisk-otter-8823/i })) as HTMLButtonElement;
  expect(bob.disabled).toBe(false);

  await userEvent.click(alice);
  await screen.findByText("terminal.share.inviteSent");

  expect(bob.disabled).toBe(true);
  expect(screen.getByText("terminal.share.inviteCapReached")).toBeTruthy();
});

test("an already-invited row cannot be tapped a second time", async () => {
  // Cap high enough that the cap guard is not what blocks the row — at cap 1 the
  // invited row is deliberately exempt from `capBlocked`, which is exactly why it
  // needs its own guard.
  h.allTeammates.mockResolvedValue(roster);
  const onInvite = vi.fn().mockResolvedValue(undefined);
  render(<Harness {...base} onInvite={onInvite} />);
  const alice = (await screen.findByRole("button", { name: /amber-lynx-4410/i })) as HTMLButtonElement;
  await userEvent.click(alice);
  await screen.findByText("terminal.share.inviteSent");

  expect(alice.disabled).toBe(true);
  await userEvent.click(alice);
  expect(onInvite).toHaveBeenCalledTimes(1);
});
