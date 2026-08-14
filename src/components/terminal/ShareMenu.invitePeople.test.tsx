import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";

/**
 * `InvitePeopleSection` renders null until its `allTeammates()` roster promise
 * resolves, so a synchronous `queryByText(...)).toBeNull()` right after `render`
 * passes trivially — with or without a hiding fix — because the section hasn't
 * rendered its content yet either way. Flush the already-resolved mock promise's
 * microtasks (and the resulting effect/state-update) before asserting absence,
 * so a regression that lets the section mount would actually have painted by
 * the time we check.
 */
async function flushRoster() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

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

// vi.mock factories run lazily (when the mocked module is first resolved), unlike
// vi.hoisted callbacks — so, unlike vi.hoisted, they can safely call into a normally
// imported helper module. State is retrieved back via useX.getState() below.
vi.mock("@/stores/teamStore", async () => {
  const { makeTeamState, asStoreHook } = await import("./ShareMenu.testHarness");
  return { useTeamStore: asStoreHook(makeTeamState()) };
});
vi.mock("@/stores/teamSessionStore", async () => {
  const { makeMpState, asStoreHook } = await import("./ShareMenu.testHarness");
  return { useTeamSessionStore: asStoreHook(makeMpState()) };
});
vi.mock("@/utils/clipboard", () => ({ writeClipboard: vi.fn(async () => {}) }));

import { useTeamStore } from "@/stores/teamStore";
import { useTeamSessionStore } from "@/stores/teamSessionStore";
import { type MpState } from "./ShareMenu.testHarness";
import { ShareMenu } from "./ShareMenu";

const teamState = useTeamStore.getState();
const mpState = useTeamSessionStore.getState() as unknown as MpState;
// Kept as the same mock instances across tests (mockClear'd, not replaced) — the
// component reads them off the live `mpState` object at render time via the store
// selector, so replacing the function references here would desync from that read.
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
    // sessionKeyBytes present: a direct/vault session retains its key, so the
    // invite section can offer to invite more people (#66 FIX4).
    mpState.connections = {
      "local-1": {
        multiplayerSessionId: "mp-1", ended: false,
        participants: [{ user_id: "me", display_name: "Me" }], myUserId: "me", controlHolder: "me",
        sessionKeyBytes: new Uint8Array([1]),
      },
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

test("an already-invited teammate renders as non-tappable Has access", async () => {
  mpState.activeSessions = [{ id: "mp-1", invitee_ids: ["alice"] }];
  renderShareMenu({ sharing: true });

  const row = await screen.findByRole("button", { name: /alice/i });
  expect((row as HTMLButtonElement).disabled).toBe(true);
  expect(row.textContent).toContain("terminal.share.inviteHasAccess");
});

test("hides the invite section in the active view when no session key is retained (invite_link)", async () => {
  // No sessionKeyBytes on the connection — mirrors an invite_link session.
  mpState.connections = {
    "local-1": { multiplayerSessionId: "mp-1", ended: false, participants: [{ user_id: "me", display_name: "Me" }], myUserId: "me", controlHolder: "me" },
  };
  const anchorRef = createRef<HTMLButtonElement>();
  render(
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
  await flushRoster();
  expect(screen.queryByText("terminal.share.invitePeople")).toBeNull();
});

test("hides the invite section in setup view for free tier", async () => {
  teamState.teams = [{ id: "vault-1", name: "Vault", owner_id: "u0", owner_tier: "teams", created_at: "", role_ids: [] }];
  const anchorRef = createRef<HTMLButtonElement>();
  render(
    <ShareMenu
      anchorRef={anchorRef}
      open
      onClose={() => {}}
      activeSessionId="local-1"
      connectionName="web-prod"
      connectionVaultId="vault-1"
      isLoggedIn
      tier="free"
      onSignIn={() => {}}
      onUpgrade={() => {}}
    />,
  );
  await flushRoster();
  expect(screen.queryByText("terminal.share.invitePeople")).toBeNull();
});
