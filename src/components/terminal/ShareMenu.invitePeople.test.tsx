import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";

/**
 * `PeopleTab` renders its search box synchronously, but its `allTeammates()`
 * roster promise resolving is what could reveal a regression (e.g. a row that
 * shouldn't be there). Flush the already-resolved mock promise's microtasks
 * (and the resulting effect/state-update) before asserting, so a regression
 * that lets the tab mount would actually have painted by the time we check.
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
// Kept as the same mock instances across tests (reset in place, not replaced) — the
// component reads them off the live `mpState` object at render time via the store
// selector, so replacing the function references here would desync from that read.
const { startSharingDirect, inviteToActiveSession } = mpState;

beforeEach(() => {
  teamState.teams = [];
  teamState.loading = false;
  mpState.connections = {};
  mpState.activeSessions = [];
  startSharingDirect.mockReset().mockResolvedValue("mp-1");
  inviteToActiveSession.mockReset().mockResolvedValue(undefined);
  h.allTeammates.mockReset().mockResolvedValue(roster);
});
afterEach(() => cleanup());

/**
 * A locally-hosted, live session. `sessionKeyBytes` present means a direct/vault
 * session that retained its key, so the invite section can offer more invites
 * (#66 FIX4); pass `{ sessionKeyBytes: undefined }` for the invite_link shape.
 */
function hostConnection(extra: Record<string, unknown> = {}) {
  return {
    "local-1": {
      multiplayerSessionId: "mp-1", ended: false,
      participants: [{ user_id: "me", display_name: "Me" }], myUserId: "me", controlHolder: "me",
      sessionKeyBytes: new Uint8Array([1]),
      ...extra,
    },
  };
}

interface ShareMenuOverrides {
  tier?: "free" | "pro" | "teams" | "business";
  connectionVaultId?: string;
}

function shareMenuElement(o: ShareMenuOverrides = {}) {
  return (
    <ShareMenu
      anchorRef={createRef<HTMLButtonElement>()}
      open
      onClose={() => {}}
      activeSessionId="local-1"
      connectionName="web-prod"
      connectionVaultId={o.connectionVaultId ?? "personal"}
      isLoggedIn
      tier={o.tier ?? "pro"}
      onSignIn={() => {}}
      onUpgrade={() => {}}
    />
  );
}

function renderShareMenu(o: ShareMenuOverrides & { sharing?: boolean } = {}) {
  if (o.sharing) mpState.connections = hostConnection();
  return render(shareMenuElement(o));
}

/** Every seats/participants-vs-cap line currently on screen, whichever key renders it. */
function ratioLines() {
  return screen.queryAllByText(/^terminal\.share\.\w*[Rr]atio$/);
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

test("hides the People tab's content in the active view when no session key is retained (invite_link)", async () => {
  mpState.connections = hostConnection({ sessionKeyBytes: undefined });
  render(shareMenuElement());
  await flushRoster();
  expect(screen.queryByPlaceholderText("terminal.share.peopleSearchPlaceholder")).toBeNull();
});

test("the active view shows exactly one seats-vs-cap line, with and without a retained session key", async () => {
  // With the invite roster: the roster's own line already counts standing invites,
  // so a second line above it would contradict it (e.g. "0 / 1" over "1 / 1").
  renderShareMenu({ sharing: true });
  await screen.findByRole("button", { name: /alice/i });
  expect(ratioLines().length).toBe(1);
  cleanup();

  // invite_link session: no roster is rendered, so the view still owes its own line.
  mpState.connections = hostConnection({ sessionKeyBytes: undefined });
  render(shareMenuElement());
  await flushRoster();
  expect(ratioLines().length).toBe(1);
});

// ─── Guest cap wired through both PeopleTab render sites (#66 follow-up) ──

test("setup view: a Pro host (cap 1) cannot tap a second teammate after the first invite lands", async () => {
  // Needs two teammates so there's a "remaining" row left to prove is now blocked.
  h.allTeammates.mockResolvedValue([
    ...roster,
    { user_id: "carol", team_id: "t1", display_name: "Carol", is_online: true, teamIds: ["t1"] },
  ]);
  // The real startSharingDirect creates the session and writes `connections`, which
  // flips ShareMenu from the setup branch to ActiveSharingView — a *different*
  // PeopleTab instance. `invitee_ids` stays empty on purpose: the server list
  // round-trip that fills it is fire-and-forget and has not landed yet.
  startSharingDirect.mockImplementation(async () => {
    mpState.connections = hostConnection();
    mpState.activeSessions = [{ id: "mp-1", invitee_ids: [] }];
    return "mp-1";
  });
  const { rerender } = renderShareMenu({ sharing: false });
  const alice = await screen.findByRole("button", { name: /alice/i });
  await userEvent.click(alice);
  // Stands in for zustand notifying subscribers of the `connections` write.
  rerender(shareMenuElement());

  expect(startSharingDirect).toHaveBeenCalledTimes(1);
  await screen.findByText("terminal.share.inviteSent");
  const carol = (await screen.findByRole("button", { name: /carol/i })) as HTMLButtonElement;
  expect(carol.disabled).toBe(true);
  expect(screen.getByText("terminal.share.inviteCapReached")).toBeTruthy();
});

test("active view: a Pro host (cap 1) already at cap shows the remaining rows as non-tappable", async () => {
  mpState.connections = hostConnection({
    participants: [{ user_id: "me", display_name: "Me" }, { user_id: "guest-1", display_name: "Guest" }],
  });
  render(shareMenuElement());
  const alice = (await screen.findByRole("button", { name: /alice/i })) as HTMLButtonElement;
  expect(alice.disabled).toBe(true);
  expect(screen.getByText("terminal.share.inviteCapReached")).toBeTruthy();
});

test("hides the People tab (and its own tab button) in setup view for free tier", async () => {
  teamState.teams = [{ id: "vault-1", name: "Vault", owner_id: "u0", owner_tier: "teams", created_at: "", role_ids: [] }];
  render(shareMenuElement({ tier: "free", connectionVaultId: "vault-1" }));
  await flushRoster();
  expect(screen.queryByText("terminal.share.tabPeople")).toBeNull();
  expect(screen.queryByPlaceholderText("terminal.share.peopleSearchPlaceholder")).toBeNull();
});
