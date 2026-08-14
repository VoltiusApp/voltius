import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, opts?: { returnObjects?: boolean }) => (opts?.returnObjects ? [] : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

const roster = [{ user_id: "alice", team_id: "t1", display_name: "Alice", is_online: true, teamIds: ["t1"] }];

const h = vi.hoisted(() => ({ allTeammates: vi.fn() }));
vi.mock("@/services/teamSharing", async () => {
  const actual = await vi.importActual<typeof import("@/services/teamSharing")>("@/services/teamSharing");
  return { ...actual, allTeammates: h.allTeammates };
});

interface TeamState {
  teams: { id: string; name: string; owner_tier: string }[];
  loading: boolean;
  loadTeams: ReturnType<typeof vi.fn>;
  loadMembers: ReturnType<typeof vi.fn>;
  membersByTeam: Record<string, unknown[]>;
}
interface MpState {
  connections: Record<string, unknown>;
  activeSessions: unknown[];
  startSharing: ReturnType<typeof vi.fn>;
  startSharingInviteLink: ReturnType<typeof vi.fn>;
  startSharingDirect: ReturnType<typeof vi.fn>;
  inviteToActiveSession: ReturnType<typeof vi.fn>;
  stopSharing: ReturnType<typeof vi.fn>;
}

const s = vi.hoisted(() => {
  const teamState: TeamState = {
    teams: [],
    loading: false,
    loadTeams: vi.fn(async () => {}),
    loadMembers: vi.fn(async () => {}),
    membersByTeam: {},
  };
  const useTeamStore: any = (sel?: (s: TeamState) => unknown) => (sel ? sel(teamState) : teamState);
  useTeamStore.getState = () => teamState;

  const mpState: MpState = {
    connections: {},
    activeSessions: [],
    startSharing: vi.fn(),
    startSharingInviteLink: vi.fn(),
    startSharingDirect: vi.fn(async () => "mp-2"),
    inviteToActiveSession: vi.fn(async () => {}),
    stopSharing: vi.fn(),
  };
  const useTeamSessionStore: any = (sel?: (s: MpState) => unknown) => (sel ? sel(mpState) : mpState);
  useTeamSessionStore.getState = () => mpState;

  return { teamState, useTeamStore, mpState, useTeamSessionStore };
});

vi.mock("@/stores/teamStore", () => ({ useTeamStore: s.useTeamStore }));
vi.mock("@/stores/teamSessionStore", () => ({ useTeamSessionStore: s.useTeamSessionStore }));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: vi.fn(async () => {}) }));

const { teamState, mpState } = s;

import { ShareMenu } from "./ShareMenu";
const { startSharingDirect, inviteToActiveSession } = mpState;

beforeEach(() => {
  teamState.teams = [];
  teamState.loading = false;
  mpState.connections = {};
  mpState.activeSessions = [];
  startSharingDirect.mockClear();
  inviteToActiveSession.mockClear();
  h.allTeammates.mockReset().mockResolvedValue(roster);
});
afterEach(() => cleanup());

function renderShareMenu({ sharing }: { sharing: boolean }) {
  if (sharing) {
    mpState.connections = {
      "local-1": { multiplayerSessionId: "mp-1", ended: false, participants: [{ user_id: "me", display_name: "Me" }], myUserId: "me", controlHolder: "me" },
    };
  }
  const anchorRef = createRef<HTMLButtonElement>();
  return render(
    <ShareMenu
      anchorRef={anchorRef}
      open
      onClose={() => {}}
      activeSessionId="local-1"
      connectionName="web-prod"
      connectionVaultId="personal"
      isLoggedIn
      tier="pro"
      onSignIn={() => {}}
      onUpgrade={() => {}}
    />,
  );
}

test("starts a direct session when a teammate is tapped on an unshared terminal", async () => {
  renderShareMenu({ sharing: false });
  await userEvent.click(await screen.findByRole("button", { name: /alice/i }));
  expect(startSharingDirect).toHaveBeenCalledWith("local-1", "web-prod", [expect.objectContaining({ user_id: "alice" })]);
});

test("adds a teammate to the live session when already sharing", async () => {
  renderShareMenu({ sharing: true });
  await userEvent.click(await screen.findByRole("button", { name: /alice/i }));
  expect(inviteToActiveSession).toHaveBeenCalledWith("local-1", expect.objectContaining({ user_id: "alice" }));
});
