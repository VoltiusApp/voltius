import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor, within } from "@testing-library/react";
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
  h.searchUsers.mockResolvedValue([{ user_id: "s1", display_name: "Sam", handle: "sam-q", is_teammate: false }]);
  render(<PeopleTab {...base} />);
  await userEvent.type(screen.getByRole("textbox"), "sam-q");
  const row = await screen.findByRole("button", { name: /sam/i });
  expect(within(row).getByText("terminal.share.notInYourTeams")).toBeTruthy();
  expect(within(row).getByText("@sam-q")).toBeTruthy();
});

test("a recent row already in the session renders as having access and cannot be invited", async () => {
  useRecentPeopleStore.setState({ recent: [{ user_id: "r1", handle: "kev", display_name: "Kevin", last_invited_at: "" }], recentUpdatedAt: "" });
  const onInvite = vi.fn();
  render(<PeopleTab {...base} session={{ vaultIds: [], participantIds: ["r1"], invitedIds: [] }} onInvite={onInvite} />);
  const row = await screen.findByRole("button", { name: /kevin/i });
  expect((row as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(row);
  expect(onInvite).not.toHaveBeenCalled();
});

test("inviting remembers the person", async () => {
  h.searchUsers.mockResolvedValue([{ user_id: "s1", display_name: "Sam", handle: "sam-q", is_teammate: false }]);
  render(<PeopleTab {...base} onInvite={async () => {}} />);
  await userEvent.type(screen.getByRole("textbox"), "sam-q");
  await userEvent.click(await screen.findByRole("button", { name: /sam/i }));
  await waitFor(() => expect(useRecentPeopleStore.getState().recent[0].user_id).toBe("s1"));
});
