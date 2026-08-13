import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { createRef } from "react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string, opts?: { returnObjects?: boolean }) => (opts?.returnObjects ? [] : k) }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));
vi.mock("@iconify/react", () => ({ Icon: () => null }));

interface TeamState {
  teams: { id: string; name: string; owner_tier: string }[];
  loading: boolean;
  loadTeams: ReturnType<typeof vi.fn>;
  loadMembers: ReturnType<typeof vi.fn>;
  membersByTeam: Record<string, unknown[]>;
}
interface MpState {
  connections: Record<string, unknown>;
  startSharing: ReturnType<typeof vi.fn>;
  startSharingInviteLink: ReturnType<typeof vi.fn>;
  stopSharing: ReturnType<typeof vi.fn>;
}

const h = vi.hoisted(() => {
  const teamState: TeamState = {
    teams: [],
    loading: false,
    loadTeams: vi.fn(async () => {}),
    loadMembers: vi.fn(async () => {}),
    membersByTeam: {},
  };
  const useTeamStore: any = (sel?: (s: TeamState) => unknown) => (sel ? sel(teamState) : teamState);
  useTeamStore.getState = () => teamState;

  // Mirrors the real store: startSharingInviteLink writes `connections` before it
  // resolves, so `activeMp` exists (and isSharing flips true) by the time
  // ShareMenu re-renders — same ordering that made autoCopied miss the field.
  const mpState: MpState = { connections: {}, startSharing: vi.fn(), startSharingInviteLink: vi.fn(), stopSharing: vi.fn() };
  const resetMpState = () => {
    mpState.connections = {};
    mpState.startSharing = vi.fn(async () => "mp-1");
    mpState.startSharingInviteLink = vi.fn(async (localSessionId: string) => {
      mpState.connections = {
        ...mpState.connections,
        [localSessionId]: { multiplayerSessionId: "mp-1", ended: false, participants: [], myUserId: "me", controlHolder: "me" },
      };
      return { multiplayerSessionId: "mp-1", inviteToken: "tok-abc" };
    });
    mpState.stopSharing = vi.fn(async () => {});
  };
  resetMpState();
  const useTeamSessionStore: any = (sel?: (s: MpState) => unknown) => (sel ? sel(mpState) : mpState);
  useTeamSessionStore.getState = () => mpState;

  return { teamState, useTeamStore, mpState, resetMpState, useTeamSessionStore, writeClipboard: vi.fn(async (_text: string) => {}) };
});

vi.mock("@/stores/teamStore", () => ({ useTeamStore: h.useTeamStore }));
vi.mock("@/stores/teamSessionStore", () => ({ useTeamSessionStore: h.useTeamSessionStore }));
vi.mock("@/utils/clipboard", () => ({ writeClipboard: (text: string) => h.writeClipboard(text) }));

const { teamState, mpState, resetMpState, writeClipboard } = h;

import { ShareMenu } from "./ShareMenu";

beforeEach(() => {
  teamState.teams = [];
  teamState.loading = false;
  teamState.loadTeams = vi.fn(async () => {});
  teamState.loadMembers = vi.fn(async () => {});
  teamState.membersByTeam = {};
  resetMpState();
  writeClipboard.mockReset().mockResolvedValue(undefined);
});
afterEach(() => cleanup());

function renderMenu() {
  const anchorRef = createRef<HTMLButtonElement>();
  // tier="pro" with a personal (non-qualifying) vault means the invite-link tab
  // is the only tab, so it renders directly without a tab click.
  return render(
    <ShareMenu
      anchorRef={anchorRef}
      open
      onClose={() => {}}
      activeSessionId="local-1"
      connectionName="Prod DB"
      connectionVaultId="personal"
      isLoggedIn
      tier="pro"
      onSignIn={() => {}}
      onUpgrade={() => {}}
    />,
  );
}

async function generateInviteLink() {
  renderMenu();
  fireEvent.click(screen.getByText("terminal.share.generateInviteLink"));
  await waitFor(() => expect(mpState.startSharingInviteLink).toHaveBeenCalled());
}

test("generating an invite link copies the code to the clipboard and shows the copied state", async () => {
  await generateInviteLink();

  await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith("mp-1:tok-abc"));
  await waitFor(() => expect(screen.getByText("terminal.shared.copied")).toBeTruthy());

  const input = screen.getByDisplayValue("mp-1:tok-abc") as HTMLInputElement;
  expect(input.value).toBe("mp-1:tok-abc");
});

test("a rejecting writeClipboard leaves the share successful and the field uncopied", async () => {
  writeClipboard.mockRejectedValue(new Error("denied"));

  await generateInviteLink();

  await waitFor(() => expect(writeClipboard).toHaveBeenCalledWith("mp-1:tok-abc"));
  // Share itself still succeeded: the code field is rendered, no error surfaced.
  expect(screen.getByDisplayValue("mp-1:tok-abc")).toBeTruthy();
  expect(screen.queryByText("terminal.share.failedToGenerateLink")).toBeNull();
  expect(screen.getByText("common.action.copy")).toBeTruthy();
  expect(screen.queryByText("terminal.shared.copied")).toBeNull();
});
